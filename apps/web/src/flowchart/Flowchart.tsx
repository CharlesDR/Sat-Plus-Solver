/**
 * The factory flowchart (PLAN M7): the plan's graph, laid out by ELK in the
 * layout worker and drawn with React Flow. Edges follow ELK's routes and show
 * their rates. Selecting a node selects its table row and back.
 */
import {
  nodeLines,
  type FactoryGraph,
  type FactoryLayout,
  type LayoutEngine,
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
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { flowNodeIcon } from '../icons/icons';
import type { Selection } from '../selection';
import type { Catalog, CatalogRecipe } from '../solver/protocol';
import { FitIcon } from '../ui/icons';
import { ICON_SIZE, useLayout } from './useLayout';

type FlowNodeData = { node: PlacedNode; icon: string | undefined };
type FlowchartNode = Node<FlowNodeData, 'flow'>;
/** `weight` is the edge's rate relative to the largest in the plan, 0–1. */
type FlowEdgeData = { edge: PlacedEdge; active: boolean; weight: number };
type FlowchartEdge = Edge<FlowEdgeData, 'routed'>;

const KIND_LABEL = {
  recipe: 'Recipe',
  resource: 'Resource node',
  import: 'Import',
  missing: 'Missing input',
  target: 'Target',
  byproduct: 'Byproduct',
} as const;

/**
 * A node is a hexagon with vertices left and right (A40): inputs meet the left
 * vertex, the main product leaves the right one, and byproducts leave the
 * lower and upper right vertices. The left sides carry the kind's colour.
 */
const FlowNodeView = memo(function FlowNodeView({ data }: NodeProps<FlowchartNode>) {
  const { title, details } = data.node.text;
  const { width: w, height: h, slant: s } = data.node;
  const outline = `${s},0.5 ${w - s},0.5 ${w - 0.5},${h / 2} ${w - s},${h - 0.5} ${s},${h - 0.5} 0.5,${h / 2}`;
  return (
    <div className={`flow-node ${data.node.kind}`} style={{ paddingInline: s + 7 }}>
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
          {data.node.label.slice(0, 1)}
        </span>
      )}
      {/* Lines come wrapped from the layout, which sized the node to fit them. */}
      <div className="flow-text">
        <div className="flow-title">{title.join('\n')}</div>
        {details.length > 0 && <div className="flow-detail">{details.join('\n')}</div>}
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
});

/** An edge drawn along ELK's orthogonal route, with its rate label where ELK put it. */
const RoutedEdge = memo(function RoutedEdge({ id, data, markerEnd }: EdgeProps<FlowchartEdge>) {
  if (!data) return null;
  const { points, label } = data.edge;
  const path = points.map((p, k) => `${k ? 'L' : 'M'}${p.x},${p.y}`).join(' ');
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        {...(markerEnd ? { markerEnd } : {})}
        className={data.active ? 'flow-edge active' : 'flow-edge'}
        // Thicker for bigger flows: 1.5 px for a trickle up to 5 px for the largest.
        style={{ strokeWidth: 1.5 + 3.5 * Math.sqrt(data.weight) }}
      />
      <EdgeLabelRenderer>
        <div
          className={data.active ? 'flow-edge-label active' : 'flow-edge-label'}
          style={{
            transform: `translate(${label.x}px, ${label.y}px)`,
            width: label.width,
            height: label.height,
          }}
        >
          {label.text}
        </div>
      </EdgeLabelRenderer>
    </>
  );
});

const nodeTypes = { flow: FlowNodeView };
/** The Fit button shows the whole plan, however small its text gets. */
const FIT = { padding: 0.02, maxZoom: 1.5 };
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
  catalog: Pick<Catalog, 'recipes'>;
  selection: Selection | undefined;
  onSelect: (id: string | undefined) => void;
}) {
  const state = useLayout(props.engine, props.graph);
  const recipes = useMemo(
    () => new Map(props.catalog.recipes.map((r) => [r.id, r])),
    [props.catalog.recipes],
  );
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
            selection={props.selection}
            onSelect={props.onSelect}
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
  selection: Selection | undefined;
  onSelect: (id: string | undefined) => void;
}) {
  const { layout, recipes, selection, onSelect } = props;
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
  const maxRate = useMemo(() => Math.max(0, ...layout.edges.map((e) => e.rate)), [layout]);
  const nodes = useMemo<FlowchartNode[]>(
    () =>
      layout.nodes.map((n) => ({
        id: n.id,
        type: 'flow',
        position: { x: n.x, y: n.y },
        width: n.width,
        height: n.height,
        style: { width: n.width, height: n.height },
        data: { node: n, icon: flowNodeIcon(n, recipes) },
        selected: n.id === selected,
        draggable: false,
        connectable: false,
        ariaLabel: `${KIND_LABEL[n.kind]}: ${nodeLines(n).join(', ')}`,
      })),
    [layout, selected, recipes],
  );
  const edges = useMemo<FlowchartEdge[]>(
    () =>
      layout.edges.map((e) => {
        const active = e.source === selected || e.target === selected;
        return {
          id: e.id,
          type: 'routed',
          source: e.source,
          target: e.target,
          selectable: false,
          zIndex: active ? 1 : 0,
          data: { edge: e, active, weight: maxRate > 0 ? e.rate / maxRate : 0 },
        };
      }),
    [layout, selected, maxRate],
  );
  return (
    <div
      ref={box}
      className="flow-canvas"
      data-testid="flowchart"
      style={view ? { height: view.height } : { aspectRatio: `${layout.width} / ${layout.height}` }}
    >
      {view && (
        <ReactFlow<FlowchartNode, FlowchartEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          onNodeClick={(_, n) => onSelect(n.id === selected ? undefined : n.id)}
          onPaneClick={() => onSelect(undefined)}
          defaultViewport={view}
          minZoom={0.05}
          maxZoom={4}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} size={1} />
          <Controls showInteractive={false} showFitView={false}>
            <FitButton />
          </Controls>
          <Follow layout={layout} box={box} selection={selection} />
        </ReactFlow>
      )}
    </div>
  );
}

/** Shows the whole plan, whatever the zoom. */
function FitButton() {
  const flow = useReactFlow();
  return (
    <ControlButton
      onClick={() => void flow.fitView(FIT)}
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
