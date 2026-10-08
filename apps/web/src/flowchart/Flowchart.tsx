/**
 * The factory flowchart (PLAN M7): the plan's graph, laid out by ELK in the
 * layout worker and drawn with React Flow. Edges follow ELK's routes and show
 * their rates. Selecting a node selects its table row and back.
 */
import {
  AREA_TITLE,
  areaStats,
  flowForm,
  nodeLines,
  rateText,
  type Bundle,
  type FlowForm,
  type FactoryGraph,
  type FactoryLayout,
  type LayoutEngine,
  type PlacedArea,
  type PlacedEdge,
  type PlacedNode,
} from '@sps/graph';
import {
  Background,
  BaseEdge,
  ControlButton,
  Controls,
  EdgeLabelRenderer,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { createPortal } from 'react-dom';
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { useEscapeLayer } from '../escape';
import { flowNodeIcon, itemIcon } from '../icons/icons';
import type { Selection } from '../selection';
import { formatExact } from '@sps/solver';
import type { Catalog, CatalogRecipe } from '../solver/protocol';
import { FitIcon } from '../ui/icons';
import { ICON_SIZE, LABEL_ICON_SIZE, useLayout } from './useLayout';

type FlowNodeData = {
  node: PlacedNode;
  icon: string | undefined;
  /** Dimmed while another node or line has the focus (A48). */
  dim: boolean;
  /** Its click tooltip is open (A48). */
  tip: boolean;
  form: (item: string) => FlowForm;
  name: (item: string) => string;
};
type FlowchartNode = Node<FlowNodeData, 'flow'>;
/** An area's frame (A64), drawn behind its boxes and lines. */
type FrameData = { area: PlacedArea; tone: number; controls: AreaControls };
type FrameNode = Node<FrameData, 'frame'>;
type CanvasNode = FlowchartNode | FrameNode;

/** What the area frames and boxes can do (A64); absent when the plan is not grouped. */
export interface AreaControls {
  /** Every area a box can move to, by the factory's names. */
  choices: readonly { id: string; name: string }[];
  /** Some area is collapsed. */
  collapsed: boolean;
  /** Boxes the factory moved, by node id. */
  moves: Readonly<Record<string, string>>;
  setCollapsed(area: string, collapsed: boolean): void;
  expandAll(): void;
  rename(area: string, name: string): void;
  /** `undefined` sends the box back to its own area. */
  move(node: string, area: string | undefined): void;
}
/** Frame tints, cycled in production order. */
const TONES = 6;
/**
 * `weight`: the line's rate on a log scale against the largest in the plan,
 * 0–1. `secondary`: not its source's main product (A48). `hot`: touches the
 * selected node or is hovered. `trunk`: the bundle this edge is the first
 * branch of, whose trunk label and split point it draws (A46).
 */
type FlowEdgeData = {
  edge: PlacedEdge;
  form: FlowForm;
  icon: string | undefined;
  weight: number;
  secondary: boolean;
  hot: boolean;
  dim: boolean;
  trunk?: Bundle;
};
type FlowchartEdge = Edge<FlowEdgeData, 'routed'>;

const KIND_LABEL = {
  recipe: 'Recipe',
  resource: 'Resource node',
  import: 'Import',
  missing: 'Missing input',
  'sub-factory': 'Sub-factory',
  target: 'Target',
  byproduct: 'Byproduct',
  area: 'Collapsed area',
} as const;

/** A tray row's height; rows sit at least this far apart (A48). */
const TRAY_ROW = Math.max(17, LABEL_ICON_SIZE) + 2;

/** An item's small icon, or its initial where it has none. */
function ItemIcon({ src, name }: { src: string | undefined; name: string }) {
  return src ? (
    <img
      className="flow-item-icon"
      src={src}
      alt=""
      width={LABEL_ICON_SIZE}
      height={LABEL_ICON_SIZE}
    />
  ) : (
    <span className="flow-item-icon placeholder" aria-hidden="true">
      {name.slice(0, 1)}
    </span>
  );
}

/** Exact values of a node (A48): counts and rates with their fractions. */
function NodeTip({
  node,
  name,
  areas,
}: {
  node: PlacedNode;
  name: (item: string) => string;
  areas: AreaControls | undefined;
}) {
  const flows = (list: readonly { item: string; rate: number }[]) =>
    list.map((f) => (
      <li key={f.item}>
        <span>{name(f.item)}</span>
        <span className="num">{formatExact(f.rate)}/min</span>
      </li>
    ));
  return (
    <>
      <div className="flow-tip-title">{node.label}</div>
      {node.kind === 'area' && (
        <div className="num">{areaStats(node.machines ?? 0, node.power ?? 0)}</div>
      )}
      {node.kind !== 'area' && node.machines !== undefined && (
        <div className="num">
          {formatExact(node.machines)} × {node.machine}
        </div>
      )}
      {node.boilerLoad !== undefined && (
        <div className="num">Boiler load {formatExact(node.boilerLoad * 100)}%</div>
      )}
      {node.rate !== undefined && <div className="num">{formatExact(node.rate)}/min</div>}
      {node.stages !== undefined && (
        <div className="flow-tip-stages">Used at {node.stages} stages of the plan</div>
      )}
      {node.inputs.length > 0 && (
        <>
          <div className="flow-tip-head">In</div>
          <ul>{flows(node.inputs)}</ul>
        </>
      )}
      {node.outputs.length > 0 && (
        <>
          <div className="flow-tip-head">Out</div>
          <ul>{flows(node.outputs)}</ul>
        </>
      )}
      {areas && node.kind === 'area' && node.area !== undefined && (
        <button
          type="button"
          className="flow-tip-action"
          onClick={() => areas.setCollapsed(node.area!, false)}
        >
          Expand area
        </button>
      )}
      {areas && node.kind !== 'area' && node.area !== undefined && (
        <label className="flow-tip-area">
          Area
          <select
            value={areas.moves[node.id] ?? ''}
            onChange={(e) => areas.move(node.id, e.target.value || undefined)}
          >
            <option value="">
              Own area{areas.moves[node.id] === undefined ? ` (${areaName(areas, node.area)})` : ''}
            </option>
            {areas.choices.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}

/** An area keeps its tint from plan to plan: by its place in production order. */
const tone = (areas: AreaControls, id: string, fallback: number) => {
  const k = areas.choices.findIndex((c) => c.id === id);
  return (k < 0 ? fallback : k) % TONES;
};

const areaName = (areas: AreaControls, id: string) =>
  areas.choices.find((a) => a.id === id)?.name ?? id;

/**
 * An area's frame (A64): a light tint behind its boxes, with a title bar
 * showing its name, machines and power. Double-click the name to rename the
 * area in this factory; the button collapses it to one box.
 */
const AreaFrame = memo(function AreaFrame({ data }: NodeProps<FrameNode>) {
  const { area, controls } = data;
  const [editing, setEditing] = useState(false);
  const cancelled = useRef(false);
  return (
    <div className={`flow-area tone-${data.tone}`} data-area={area.id}>
      <div className="flow-area-head" style={{ height: AREA_TITLE }}>
        {editing ? (
          <input
            className="flow-area-name nodrag"
            defaultValue={area.name}
            aria-label="Area name"
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => {
              if (!cancelled.current) controls.rename(area.id, e.currentTarget.value);
              cancelled.current = false;
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              else if (e.key === 'Escape') {
                // Handled here, so Esc only ends the edit.
                e.preventDefault();
                cancelled.current = true;
                e.currentTarget.blur();
              }
            }}
          />
        ) : (
          <span
            className="flow-area-name"
            title="Double-click to rename"
            onDoubleClick={() => setEditing(true)}
          >
            {area.name}
          </span>
        )}
        <span className="flow-area-stats num">{areaStats(area.machines, area.power)}</span>
        <button
          type="button"
          className="flow-area-toggle nodrag"
          title={`Collapse ${area.name} to one box`}
          aria-label={`Collapse ${area.name}`}
          onClick={() => controls.setCollapsed(area.id, true)}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2.5 6h7" />
          </svg>
        </button>
      </div>
    </div>
  );
});

/**
 * A node is a hexagon with vertices left and right (A40), its inputs meeting
 * the slanted sides; right of it, the output tray lists what it makes, one
 * row per item that its line leaves from (A48). The left sides carry the
 * kind's colour; a raw input used at several stages is marked (A47).
 */
const FlowNodeView = memo(function FlowNodeView({ data }: NodeProps<FlowchartNode>) {
  const n = data.node;
  const { title, details } = n.text;
  const { height: h, slant: s, tray } = n;
  const w = n.width - tray;
  const outline = `${s},0.5 ${w - s},0.5 ${w - 0.5},${h / 2} ${w - s},${h - 0.5} ${s},${h - 0.5} 0.5,${h / 2}`;
  const ys = n.rows.map((r) => r.y);
  const top = Math.min(...ys) - TRAY_ROW / 2;
  const classes = ['flow-node', n.kind];
  if (n.stages !== undefined) classes.push('multi-stage');
  if (data.dim) classes.push('dim');
  if (data.tip) classes.push('tip');
  return (
    <div className={classes.join(' ')} style={{ paddingLeft: s + 7, paddingRight: tray + s + 7 }}>
      <svg className="flow-hex" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
        <polygon className="flow-hex-shadow" points={outline} />
        <polygon className="flow-hex-body" points={outline} />
        <polyline
          className="flow-hex-kind"
          points={`${s + 1},1.5 1.5,${h / 2} ${s + 1},${h - 1.5}`}
        />
      </svg>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      {data.icon ? (
        <img className="flow-icon" src={data.icon} alt="" width={ICON_SIZE} height={ICON_SIZE} />
      ) : (
        <span className="flow-icon placeholder" aria-hidden="true">
          {n.label.slice(0, 1)}
        </span>
      )}
      {/* Lines come wrapped from the layout, which sized the node to fit them. */}
      <div className="flow-text">
        <div className="flow-title">{title.join('\n')}</div>
        {details.length > 0 && <div className="flow-detail">{details.join('\n')}</div>}
      </div>
      {n.stages !== undefined && (
        <span className="flow-stages" style={{ left: w / 2 }}>
          {n.stages} stages
        </span>
      )}
      {tray > 0 && (
        <div
          className="flow-tray"
          style={{ left: w, width: tray, top, height: Math.max(...ys) - top + TRAY_ROW / 2 }}
        >
          {n.rows.map((r) => (
            <div
              key={r.item}
              className={`flow-tray-row form-${data.form(r.item)}`}
              style={{ top: r.y - top - TRAY_ROW / 2, height: TRAY_ROW }}
              title={`${data.name(r.item)}: ${formatExact(r.rate)}/min`}
            >
              <ItemIcon src={itemIcon(r.item)} name={data.name(r.item)} />
              <span className="num">{rateText(r.rate)}</span>
            </div>
          ))}
        </div>
      )}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
});

/**
 * An edge drawn along ELK's orthogonal route, coloured by its item's form
 * and weighted by its rate (A48), with its icon and rate just before the
 * port it enters. The item's name shows on hover.
 */
const RoutedEdge = memo(function RoutedEdge({ id, data }: EdgeProps<FlowchartEdge>) {
  if (!data) return null;
  const { points, label, itemName, rate } = data.edge;
  const path = points.map((p, k) => `${k ? 'L' : 'M'}${p.x},${p.y}`).join(' ');
  const state = `form-${data.form}${data.secondary ? ' secondary' : ''}${data.hot ? ' active' : ''}${data.dim ? ' dim' : ''}`;
  const tag = (
    box: { x: number; y: number; width: number; height: number; text: string },
    extra: string,
    title: string,
  ) => (
    <div
      className={`flow-edge-label ${state}${extra}`}
      style={{
        transform: `translate(${box.x}px, ${box.y}px)`,
        width: box.width,
        height: box.height,
      }}
      title={title}
    >
      <ItemIcon src={data.icon} name={itemName} />
      <span className="num">{box.text}</span>
    </div>
  );
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        className={`flow-edge ${state}`}
        interactionWidth={10}
        // Thicker for bigger flows: 1.5 px for a trickle up to 5 px for the largest.
        style={{ strokeWidth: 1.5 + 3.5 * data.weight }}
      />
      <EdgeLabelRenderer>
        {tag(label, '', `${itemName}: ${formatExact(rate)}/min`)}
        {data.trunk &&
          tag(
            data.trunk.label,
            ' trunk',
            `${itemName}: ${formatExact(data.trunk.rate)}/min in all`,
          )}
      </EdgeLabelRenderer>
      {data.trunk && (
        <circle
          className={`flow-split ${state}`}
          cx={data.trunk.split.x}
          cy={data.trunk.split.y}
          r={3}
        />
      )}
    </>
  );
});

const nodeTypes = { flow: FlowNodeView, frame: AreaFrame };
/** The Fit button shows the whole plan, however small its text gets, up to MAX_ZOOM. */
const FIT = { padding: 0.02 };
/**
 * The plan opens at the width of the canvas, but never so far out that its
 * 14 px text drops below 12 px on screen, and never past 1.5×. A plan too big
 * for that starts at its left (inputs) end; drag or zoom to see the rest.
 */
const MIN_ZOOM = 12 / 14;
const MAX_ZOOM = 1.5;
const PAD = 8;
const edgeTypes = { routed: RoutedEdge };

export function Flowchart(props: {
  engine: LayoutEngine;
  graph: FactoryGraph;
  catalog: Pick<Catalog, 'recipes' | 'fluids'>;
  selection: Selection | undefined;
  onSelect: (id: string | undefined) => void;
  /** Double-click on a sub-factory box (A53). */
  onOpenFactory?: (id: string) => void;
  /** The plan is grouped in areas (A64). */
  areas?: AreaControls;
}) {
  const state = useLayout(props.engine, props.graph);
  const recipes = useMemo(
    () => new Map(props.catalog.recipes.map((r) => [r.id, r])),
    [props.catalog.recipes],
  );
  const fluids = useMemo(() => new Set(props.catalog.fluids), [props.catalog.fluids]);
  if (!props.graph.nodes.length) return null;
  return (
    <section className="flowchart factory-flowchart" aria-label="Flowchart">
      {state.kind === 'pending' && <p className="hint">Laying out the flowchart…</p>}
      {state.kind === 'error' && (
        <p className="error" role="alert">
          The flowchart layout failed: {state.message}
        </p>
      )}
      {state.kind === 'done' && (
        <ReactFlowProvider>
          <Canvas
            layout={state.layout}
            recipes={recipes}
            fluids={fluids}
            selection={props.selection}
            onSelect={props.onSelect}
            {...(props.onOpenFactory ? { onOpenFactory: props.onOpenFactory } : {})}
            {...(props.areas ? { areas: props.areas } : {})}
          />
        </ReactFlowProvider>
      )}
    </section>
  );
}

/** The opening view: as wide as the canvas allows, within the zoom limits. */
function opening(layout: FactoryLayout, width: number) {
  const fit = (width - 2 * PAD) / Math.max(1, layout.width);
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, fit));
  const drawn = { width: layout.width * zoom, height: layout.height * zoom };
  // Tall enough for the drawing at that zoom, within the CSS min and max height.
  const height = Math.min(
    Math.max(360, drawn.height + 2 * PAD),
    Math.round(window.innerHeight * 0.8),
  );
  return {
    zoom,
    height,
    x: drawn.width < width ? (width - drawn.width) / 2 : PAD,
    y: drawn.height < height ? (height - drawn.height) / 2 : PAD,
  };
}

function Canvas(props: {
  layout: FactoryLayout;
  recipes: ReadonlyMap<string, CatalogRecipe>;
  fluids: ReadonlySet<string>;
  selection: Selection | undefined;
  onSelect: (id: string | undefined) => void;
  onOpenFactory?: (id: string) => void;
  areas?: AreaControls;
}) {
  const { layout, recipes, fluids, selection, onSelect, onOpenFactory, areas } = props;
  const selected = selection?.id;
  const box = useRef<HTMLDivElement>(null);
  // Measured before the first paint, so the plan opens at its view without a jump.
  const [width, setWidth] = useState<number>();
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const watch = new ResizeObserver(() => setWidth(el.clientWidth));
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  // A resize changes the canvas height only; the view moves only for a new plan.
  const view = width === undefined ? undefined : opening(layout, width);

  // The node or line under the pointer, and the node whose tooltip is open (A48).
  const [hoverNode, setHoverNode] = useState<string>();
  const [hoverEdge, setHoverEdge] = useState<string>();
  const [tip, setTip] = useState<string>();
  useTooltip(tip, setTip, selected);

  const tipNode = tip !== undefined ? layout.nodes.find((n) => n.id === tip) : undefined;
  const maxRate = useMemo(() => Math.max(0, ...layout.edges.map((e) => e.rate)), [layout]);
  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of layout.edges) m.set(e.item, e.itemName);
    for (const n of layout.nodes)
      if (n.item !== undefined && !m.has(n.item)) m.set(n.item, n.label);
    return m;
  }, [layout]);
  const name = useCallback((item: string) => names.get(item) ?? item, [names]);
  const form = useCallback((item: string) => flowForm(item, fluids), [fluids]);
  const mains = useMemo(
    () => new Map(layout.nodes.map((n) => [n.id, n.main ?? n.outputs[0]?.item])),
    [layout],
  );

  // Hovering or selecting a node keeps it, its lines and the nodes at their
  // other ends; hovering a line keeps the line and its two ends (A48).
  const focus = useMemo(() => {
    const line = hoverEdge !== undefined ? layout.edges.find((e) => e.id === hoverEdge) : undefined;
    if (line) return { nodes: new Set([line.source, line.target]), edges: new Set([line.id]) };
    const at = hoverNode ?? selected;
    if (at === undefined) return undefined;
    const touching = layout.edges.filter((e) => e.source === at || e.target === at);
    return {
      nodes: new Set([at, ...touching.flatMap((e) => [e.source, e.target])]),
      edges: new Set(touching.map((e) => e.id)),
    };
  }, [layout, hoverNode, hoverEdge, selected]);

  const frames = useMemo<FrameNode[]>(
    () =>
      areas
        ? (layout.areas ?? []).map((a, k): FrameNode => ({
            id: `frame:${a.id}`,
            type: 'frame',
            position: { x: a.x, y: a.y },
            width: a.width,
            height: a.height,
            style: { width: a.width, height: a.height },
            zIndex: -1,
            data: { area: a, tone: tone(areas, a.id, k), controls: areas },
            selectable: false,
            focusable: false,
            draggable: false,
            connectable: false,
            ariaLabel: `Area: ${a.name}`,
          }))
        : [],
    [layout, areas],
  );
  const nodes = useMemo<CanvasNode[]>(
    () => [
      ...frames,
      ...layout.nodes.map((n): FlowchartNode => ({
        id: n.id,
        type: 'flow',
        position: { x: n.x, y: n.y },
        width: n.width,
        height: n.height,
        style: { width: n.width, height: n.height },
        data: {
          node: n,
          icon: flowNodeIcon(n, recipes),
          dim: focus !== undefined && !focus.nodes.has(n.id),
          tip: tip === n.id,
          form,
          name,
        },
        selected: n.id === selected,
        draggable: false,
        connectable: false,
        ariaLabel: `${KIND_LABEL[n.kind]}: ${nodeLines(n).join(', ')}`,
      })),
    ],
    // A fresh node list when the tooltip closes: React Flow drops a node's
    // selection itself on Esc, and this puts it back when Esc only closed
    // the tooltip.
    [frames, layout, selected, recipes, focus, form, name, tip],
  );
  const edges = useMemo<FlowchartEdge[]>(() => {
    const trunks = new Map(layout.bundles.map((b) => [`${b.source}\n${b.item}`, b]));
    return layout.edges.map((e) => {
      const key = `${e.source}\n${e.item}`;
      const trunk = trunks.get(key);
      trunks.delete(key);
      const hot = e.source === selected || e.target === selected || e.id === hoverEdge;
      const secondary = mains.get(e.source) !== e.item;
      return {
        id: e.id,
        type: 'routed',
        source: e.source,
        target: e.target,
        selectable: false,
        // Main lines over byproducts, the focus over both.
        zIndex: hot ? 2 : secondary ? 0 : 1,
        data: {
          edge: e,
          form: form(e.item),
          icon: itemIcon(e.item),
          weight: lineWeight(e.rate, maxRate),
          secondary,
          hot,
          dim: focus !== undefined && !focus.edges.has(e.id),
          ...(trunk ? { trunk } : {}),
        },
      };
    });
  }, [layout, selected, hoverEdge, maxRate, form, mains, focus]);
  return (
    <>
      <div
        ref={box}
        className="flow-canvas"
        data-testid="flowchart"
        style={
          view ? { height: view.height } : { aspectRatio: `${layout.width} / ${layout.height}` }
        }
      >
        {view && (
          <ReactFlow<CanvasNode, FlowchartEdge>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            onNodeClick={(_, n) => {
              if (n.type !== 'flow') return;
              const again = n.id === selected;
              onSelect(again ? undefined : n.id);
              setTip(again ? undefined : n.id);
            }}
            onNodeDoubleClick={(_, n) => {
              if (n.type !== 'flow') return;
              const { factory: sub, kind, area } = n.data.node;
              if (sub !== undefined) onOpenFactory?.(sub);
              else if (kind === 'area' && area !== undefined) areas?.setCollapsed(area, false);
            }}
            zoomOnDoubleClick={false}
            onPaneClick={() => {
              onSelect(undefined);
              setTip(undefined);
            }}
            onNodeMouseEnter={(_, n) => {
              if (n.type === 'flow') setHoverNode(n.id);
            }}
            onNodeMouseLeave={() => setHoverNode(undefined)}
            onEdgeMouseEnter={(_, e) => setHoverEdge(e.id)}
            onEdgeMouseLeave={() => setHoverEdge(undefined)}
            defaultViewport={view}
            minZoom={0.05}
            maxZoom={4}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={20} size={1} />
            <Controls showInteractive={false} showFitView={false}>
              <FitButton layout={layout} />
            </Controls>
            {tipNode && <Tooltip node={tipNode} name={name} areas={areas} />}
            <Follow layout={layout} box={box} selection={selection} />
          </ReactFlow>
        )}
        {areas?.collapsed && (
          <button type="button" className="flow-expand-all" onClick={areas.expandAll}>
            Expand all areas
          </button>
        )}
      </div>
      <Legend layout={layout} form={form} />
    </>
  );
}

/**
 * A line's weight, 0–1: its rate on a log scale against the plan's largest,
 * so a 1000th of the largest is the thinnest line (A48).
 */
export function lineWeight(rate: number, max: number): number {
  if (!(rate > 0) || !(max > 0)) return 0;
  return Math.min(1, Math.max(0, 1 + Math.log10(rate / max) / 3));
}

/**
 * The click tooltip (A48) stays open when the window loses focus, and closes
 * on a click anywhere else on the page, on Esc before anything opened
 * earlier, and when the selection moves to another node.
 */
function useTooltip(
  tip: string | undefined,
  setTip: (id: string | undefined) => void,
  selected: string | undefined,
) {
  useEffect(() => {
    if (tip !== undefined && tip !== selected) setTip(undefined);
  }, [tip, selected, setTip]);
  useEffect(() => {
    if (tip === undefined) return;
    const away = (ev: PointerEvent) => {
      if (ev.target instanceof Element && ev.target.closest('.flow-tooltip, .react-flow__node'))
        return;
      setTip(undefined);
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [tip, setTip]);
  useEscapeLayer(tip !== undefined, () => setTip(undefined), { above: true });
}

/**
 * The click tooltip (A48), drawn over the page at screen size, so neither
 * the zoom nor the canvas's edge cuts it: above its node, or below it where
 * there's no room above.
 */
function Tooltip({
  node,
  name,
  areas,
}: {
  node: PlacedNode;
  name: (item: string) => string;
  areas: AreaControls | undefined;
}) {
  const flow = useReactFlow();
  // Follows the node as the view pans and zooms, and as the page scrolls.
  useStore((s) => s.transform);
  const [, setScrolled] = useState(0);
  useEffect(() => {
    const moved = () => setScrolled((k) => k + 1);
    window.addEventListener('scroll', moved, true);
    window.addEventListener('resize', moved);
    return () => {
      window.removeEventListener('scroll', moved, true);
      window.removeEventListener('resize', moved);
    };
  }, []);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = box.current;
    if (el) setSize({ width: el.offsetWidth, height: el.offsetHeight });
  }, [node]);
  const top = flow.flowToScreenPosition({ x: node.x + node.width / 2, y: node.y });
  const bottom = flow.flowToScreenPosition({ x: node.x, y: node.y + node.height });
  const GAP = 8;
  const above = top.y - GAP - size.height >= GAP;
  const x = Math.min(Math.max(GAP, top.x - size.width / 2), window.innerWidth - size.width - GAP);
  return createPortal(
    <div
      ref={box}
      className="flow-tooltip"
      role="dialog"
      aria-label={`${node.label}: exact values`}
      style={{ left: x, top: above ? top.y - GAP - size.height : bottom.y + GAP }}
    >
      <NodeTip node={node} name={name} areas={areas} />
    </div>,
    document.body,
  );
}

/** What the line colours, dashes and marks mean (A47, A48). */
function Legend({ layout, form }: { layout: FactoryLayout; form: (item: string) => FlowForm }) {
  const forms = new Set(layout.edges.map((e) => form(e.item)));
  const multi = layout.nodes.some((n) => n.stages !== undefined);
  const entries: [string, string][] = [
    ...(['solid', 'fluid', 'gas'] as const)
      .filter((f) => forms.has(f))
      .map((f): [string, string] => [
        `form-${f}`,
        f === 'solid' ? 'Solid' : f === 'fluid' ? 'Fluid' : 'Gas',
      ]),
    ['secondary', 'Byproduct'],
  ];
  return (
    <div className="flow-legend" aria-label="Legend">
      {entries.map(([cls, text]) => (
        <span key={cls} className="flow-legend-entry">
          <svg width="22" height="8" aria-hidden="true">
            <line className={`flow-edge ${cls}`} x1="1" y1="4" x2="21" y2="4" />
          </svg>
          {text}
        </span>
      ))}
      {multi && (
        <span className="flow-legend-entry">
          <span className="flow-legend-multi" aria-hidden="true" />
          Used at several stages
        </span>
      )}
    </div>
  );
}

/**
 * Shows the whole plan, whatever the zoom: the whole drawing, so labels
 * beside the outermost nodes stay in view.
 */
function FitButton({ layout }: { layout: FactoryLayout }) {
  const flow = useReactFlow();
  return (
    <ControlButton
      onClick={() =>
        void flow
          .fitBounds({ x: 0, y: 0, width: layout.width, height: layout.height }, FIT)
          .then(() => (flow.getZoom() > MAX_ZOOM ? flow.zoomTo(MAX_ZOOM) : undefined))
      }
      title="Fit the whole plan"
      aria-label="Fit the whole plan"
    >
      <FitIcon />
    </ControlButton>
  );
}

/** Opens a new plan at its readable view, and centers a node picked in the table. */
function Follow({
  layout,
  box,
  selection,
}: {
  layout: FactoryLayout;
  box: RefObject<HTMLDivElement | null>;
  selection: Selection | undefined;
}) {
  const flow = useReactFlow();
  // The first plan opened at `defaultViewport`; each later plan opens the same way.
  const shown = useRef(layout);
  useEffect(() => {
    if (shown.current === layout || !box.current) return;
    shown.current = layout;
    const { x, y, zoom } = opening(layout, box.current.clientWidth);
    void flow.setViewport({ x, y, zoom });
  }, [flow, layout, box]);
  useEffect(() => {
    if (selection?.from !== 'table') return;
    const n = layout.nodes.find((x) => x.id === selection.id);
    if (n)
      void flow.setCenter(n.x + n.width / 2, n.y + n.height / 2, {
        zoom: Math.max(flow.getZoom(), 0.8),
        duration: 200,
      });
  }, [flow, layout, selection]);
  return null;
}
