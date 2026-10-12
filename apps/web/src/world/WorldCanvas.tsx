/**
 * The world canvas (PLAN M8): factories and groups laid out by ELK in the
 * layout worker and drawn with React Flow. Expanded groups are frames around
 * their members; collapsed groups are one node. Each card has one port per
 * part down its sides (A80); the lines between two cards fan out of their
 * ports into one trunk. Dragging from a factory's output port, or its "+"
 * handle below them, to another factory starts a link with that part. A click
 * on a factory shows the raw resources it extracts. Item trace dims everything
 * that doesn't touch the traced item.
 */
import { BUILD_STATE } from '../build/build';
import {
  layoutWorldGraph,
  MORE_PORT,
  PORT_ROW,
  portY,
  rateText,
  worldNodeLines,
  type CardItem,
  type LayoutEngine,
  type PlacedWorldEdge,
  type PlacedWorldNode,
  type WorldGraph,
  type WorldLayout,
  type WorldPort,
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
  type Connection,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  createContext,
  memo,
  startTransition,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { itemIcon } from '../icons/icons';
import { FitIcon } from '../ui/icons';
import { StatusChip } from '../ui/StatusChip';

/** What the canvas's nodes can ask the view to do. */
export interface CanvasActions {
  openFactory(id: string): void;
  /** A group, or with `nest` a factory with sub-factories (A53). */
  setCollapsed(id: string, collapsed: boolean, nest?: boolean): void;
  /** A link drawn from one factory to another, carrying `item` when drawn from or to its port. */
  connect(from: string, to: string, item?: string): void;
}

const Actions = createContext<CanvasActions | undefined>(undefined);

type Mark = 'traced' | 'dimmed' | undefined;
type WorldNodeData = { node: PlacedWorldNode; mark: Mark; selected: boolean };
type CanvasNode = Node<WorldNodeData, 'world' | 'frame'>;
type WorldEdgeData = { edge: PlacedWorldEdge; mark: Mark };
type CanvasEdge = Edge<WorldEdgeData, 'routed'>;

const STATUS = 'Status: ';

const cls = (...xs: (string | false | undefined)[]) => xs.filter(Boolean).join(' ');

/** A part's icon with its name as the tooltip and alt text; a gap where there is no icon. */
function ItemIcon({ item, name }: { item: string; name: string }) {
  const src = itemIcon(item);
  return src ? (
    <img className="world-icon" src={src} alt={name} title={name} width={16} height={16} />
  ) : (
    <span className="world-icon" title={name} />
  );
}

/** The handles that start or take a link with no part picked yet. */
export const NEW_OUT = 'new-out';
export const NEW_IN = 'new-in';
const handleId = (side: 'in' | 'out', item: string) => `${side}:${item}`;
/** A handle's part, if it is a part's port. */
const handleItem = (id: string | null | undefined) =>
  id && (id.startsWith('in:') || id.startsWith('out:')) ? id.slice(id.indexOf(':') + 1) : undefined;

const portTitle = (p: WorldPort) =>
  `${p.name}: ${rateText(p.rate)}/min` +
  (p.unmet ? ` (short ${rateText(p.unmet)}, unmet)` : '') +
  (p.surplus ? ` (${rateText(p.surplus)} spare)` : '');

/** One port on a card's edge: the part's icon, and its handle on the edge. */
function Port(props: { side: 'in' | 'out'; slot: number; port: WorldPort; connectable: boolean }) {
  const { side, slot, port } = props;
  return (
    <div
      className={cls('world-port', side, port.unmet !== undefined && 'unmet')}
      style={{ top: portY(slot) - PORT_ROW / 2 }}
      title={portTitle(port)}
      data-port={port.item}
    >
      <ItemIcon item={port.item} name={port.name} />
      <Handle
        type={side === 'in' ? 'target' : 'source'}
        position={side === 'in' ? Position.Left : Position.Right}
        id={handleId(side, port.item)}
        isConnectable={props.connectable}
      />
    </div>
  );
}

/** The "…" port (A80): spare parts and folded outputs, listed on hover or click. */
function MorePort({ slot, items }: { slot: number; items: (CardItem & { kind: string })[] }) {
  const [open, setOpen] = useState(false);
  const products = items.filter((i) => i.kind === 'product').length;
  const label = products ? `+${items.length}` : '…';
  const lines = items.map(
    (i) => `${i.name}: ${rateText(i.rate)}/min${i.kind === 'surplus' ? ' spare' : ''}`,
  );
  return (
    <div className="world-port out more" style={{ top: portY(slot) - PORT_ROW / 2 }}>
      <button
        type="button"
        className="nodrag more-button"
        aria-expanded={open}
        aria-label={`${items.length} more ${items.length === 1 ? 'part' : 'parts'}`}
        title={lines.join('\n')}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
      >
        {label}
      </button>
      {open && (
        <ul className="world-more-list nodrag" role="list" aria-label="More parts">
          {items.map((i) => (
            <li key={i.item}>
              <ItemIcon item={i.item} name={i.name} />
              {rateText(i.rate)} {i.name}
              {i.kind === 'surplus' ? ' spare' : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const WorldNodeView = memo(function WorldNodeView({ data }: NodeProps<CanvasNode>) {
  const actions = useContext(Actions)!;
  const n = data.node;
  const [title, ...rest] = worldNodeLines(n);
  const factory = n.kind === 'factory';
  // A collapsed factory with sub-factories opens like a factory (A53).
  const opens = factory || n.nest === true;
  const ins = new Map((n.inPorts ?? []).map((p) => [p.item, p]));
  const outs = new Map((n.outPorts ?? []).map((p) => [p.item, p]));
  // The "+" handles sit below the ports, or mid-edge on a side with none.
  const newAt = (count: number) =>
    count ? { top: Math.min(portY(count), n.height - 8) } : undefined;
  return (
    <div
      className={cls(
        'world-node',
        n.kind,
        n.nest && 'nest',
        n.status,
        n.manual && 'manual',
        data.selected && 'selected',
        data.mark,
      )}
      onDoubleClick={opens ? () => actions.openFactory(n.ref) : undefined}
    >
      {n.ports.in.length > 0 && (
        <div className="world-ports in" role="group" aria-label="Takes">
          {n.ports.in.map((item, k) => (
            <Port key={item} side="in" slot={k} port={ins.get(item)!} connectable={factory} />
          ))}
        </div>
      )}
      <Handle
        type="target"
        position={Position.Left}
        id={NEW_IN}
        isConnectable={factory}
        className="new-handle"
        {...(newAt(n.ports.in.length) ? { style: newAt(n.ports.in.length)! } : {})}
      />
      <div
        className="world-body"
        style={{
          paddingLeft: n.ports.in.length ? 34 : undefined,
          paddingRight: n.ports.out.length ? 34 : undefined,
        }}
      >
        <div className="flow-title" title={title}>
          {title}
        </div>
        {n.build && (
          <div className="flow-detail">
            <span className={`status-chip ${BUILD_STATE[n.build].tone}`}>
              {BUILD_STATE[n.build].label}
            </span>
          </div>
        )}
        {rest.map((l) =>
          l.startsWith(STATUS) ? (
            <div key={l} className="flow-detail">
              {STATUS}
              <StatusChip status={l.slice(STATUS.length).split(' · ')[0]!} />
              {l
                .slice(STATUS.length)
                .split(' · ')
                .slice(1)
                .map((x) => ` · ${x}`)}
            </div>
          ) : (
            <div key={l} className="flow-detail">
              {l}
            </div>
          ),
        )}
        {factory && (
          <button
            type="button"
            className="nodrag link-button"
            aria-label={`Open ${n.label}`}
            onClick={() => actions.openFactory(n.ref)}
          >
            Open
          </button>
        )}
        {n.kind === 'group' && (
          <button
            type="button"
            className="nodrag link-button"
            onClick={() => actions.setCollapsed(n.ref, false, n.nest)}
          >
            Expand
          </button>
        )}
      </div>
      {n.ports.out.length > 0 && (
        <div className="world-ports out" role="group" aria-label="Makes">
          {n.ports.out.map((item, k) =>
            item === MORE_PORT ? (
              <MorePort key={item} slot={k} items={n.more ?? []} />
            ) : (
              <Port key={item} side="out" slot={k} port={outs.get(item)!} connectable={factory} />
            ),
          )}
        </div>
      )}
      <Handle
        type="source"
        position={Position.Right}
        id={NEW_OUT}
        isConnectable={factory}
        className="new-handle"
        {...(newAt(n.ports.out.length) ? { style: newAt(n.ports.out.length)! } : {})}
      />
      {data.selected && n.raw && n.raw.length > 0 && (
        <ul className="world-raw" role="list" aria-label={`Raw resources of ${n.label}`}>
          <li className="world-raw-head">Raw resources</li>
          {n.raw.map((r) => (
            <li key={r.item}>
              <ItemIcon item={r.item} name={r.name} />
              {rateText(r.rate)} {r.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});

const FrameView = memo(function FrameView({ data }: NodeProps<CanvasNode>) {
  const actions = useContext(Actions)!;
  const n = data.node;
  return (
    <div className={cls('group-frame', n.nest && 'nest', data.mark)}>
      <div className="group-header">
        <span className="flow-title">{n.label}</span>
        <button
          type="button"
          className="nodrag link-button"
          onClick={() => actions.setCollapsed(n.ref, true, n.nest)}
        >
          Collapse
        </button>
      </div>
    </div>
  );
});

/** An edge along ELK's route (root coordinates), one label line per item. */
const RoutedEdge = memo(function RoutedEdge({ id, data, markerEnd }: EdgeProps<CanvasEdge>) {
  if (!data) return null;
  const { points, fans, label, kind, short } = data.edge;
  const line = (ps: readonly { x: number; y: number }[]) =>
    ps.map((p, k) => `${k ? 'L' : 'M'}${p.x},${p.y}`).join(' ');
  // The trunk and the fans joining the edge's other ports to it (A80).
  const path = [points, ...fans].map(line).join(' ');
  const className = cls('world-edge', kind, short && 'short', data.mark);
  return (
    <>
      <BaseEdge id={id} path={path} {...(markerEnd ? { markerEnd } : {})} className={className} />
      <EdgeLabelRenderer>
        <div
          className={cls('world-edge-label', kind, short && 'short', data.mark)}
          data-edge={id}
          style={{
            transform: `translate(${label.x}px, ${label.y}px)`,
            width: label.width,
            height: label.height,
          }}
        >
          {label.lines.map((l, k) => {
            const it = data.edge.items[k];
            return (
              <div key={l}>
                {it && <ItemIcon item={it.item} name={it.name} />}
                {l}
              </div>
            );
          })}
        </div>
      </EdgeLabelRenderer>
    </>
  );
});

const nodeTypes = { world: WorldNodeView, frame: FrameView };
/** A small world is not blown up past its natural size. */
const FIT = { maxZoom: 1 };
const edgeTypes = { routed: RoutedEdge };

type LayoutState =
  { kind: 'pending' } | { kind: 'done'; layout: WorldLayout } | { kind: 'error'; message: string };

/** Lays the graph out in the layout worker whenever its structure changes. */
function useWorldLayout(engine: LayoutEngine, graph: WorldGraph): LayoutState {
  const [settled, setSettled] = useState<{ graph: WorldGraph; state: LayoutState }>();
  useEffect(() => {
    let live = true;
    layoutWorldGraph(graph, engine).then(
      (layout) => {
        if (live) startTransition(() => setSettled({ graph, state: { kind: 'done', layout } }));
      },
      (e: unknown) => {
        const message = e instanceof Error ? e.message : String(e);
        if (live) startTransition(() => setSettled({ graph, state: { kind: 'error', message } }));
      },
    );
    return () => {
      live = false;
    };
  }, [engine, graph]);
  return settled?.graph === graph ? settled.state : { kind: 'pending' };
}

export function WorldCanvas(props: {
  engine: LayoutEngine;
  /** The graph without trace marks: its layout only changes with the structure. */
  graph: WorldGraph;
  /** The same graph with the item trace applied. */
  traced: WorldGraph;
  actions: CanvasActions;
}) {
  const state = useWorldLayout(props.engine, props.graph);
  return (
    <section className="flowchart world-canvas" aria-label="World canvas">
      {state.kind === 'pending' && <p className="hint">Laying out the world…</p>}
      {state.kind === 'error' && (
        <p className="error" role="alert">
          The world layout failed: {state.message}
        </p>
      )}
      {state.kind === 'done' && (
        <Actions.Provider value={props.actions}>
          <ReactFlowProvider>
            <Canvas layout={state.layout} traced={props.traced} connect={props.actions.connect} />
          </ReactFlowProvider>
        </Actions.Provider>
      )}
    </section>
  );
}

function Canvas(props: {
  layout: WorldLayout;
  traced: WorldGraph;
  connect: CanvasActions['connect'];
}) {
  const { layout, traced, connect } = props;
  // The factory whose raw resources show (A80); a new layout keeps it if it's still there.
  const [selected, setSelected] = useState<string>();
  const marks = useMemo(() => {
    const m = new Map<string, Mark>();
    if (traced.traceItem === undefined) return m;
    for (const x of [...traced.nodes, ...traced.edges]) m.set(x.id, x.traced ? 'traced' : 'dimmed');
    // A frame is neither: it only holds its members.
    for (const n of traced.nodes) if (n.kind === 'group' && !n.collapsed) m.delete(n.id);
    return m;
  }, [traced]);
  const kinds = useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout]);

  const nodes = useMemo<CanvasNode[]>(
    () =>
      layout.nodes.map((n) => {
        const frame = n.kind === 'group' && !n.collapsed;
        const factory = n.kind === 'factory';
        return {
          id: n.id,
          type: frame ? 'frame' : 'world',
          position: { x: n.x, y: n.y },
          ...(n.parent ? { parentId: n.parent } : {}),
          width: n.width,
          height: n.height,
          style: { width: n.width, height: n.height },
          data: { node: n, mark: marks.get(n.id), selected: n.id === selected },
          // The selected card's raw resources draw over its neighbours.
          ...(n.id === selected ? { zIndex: 5 } : {}),
          draggable: false,
          selectable: false,
          connectable: factory,
          ariaLabel: frame
            ? `Group: ${n.label}`
            : `${n.nest ? 'Factory with sub-factories' : n.kind === 'group' ? 'Group' : 'Factory'}: ${worldNodeLines(n).join(', ')}`,
        };
      }),
    [layout, marks, selected],
  );
  const edges = useMemo<CanvasEdge[]>(
    () =>
      layout.edges.map((e) => ({
        id: e.id,
        type: 'routed',
        source: e.source,
        target: e.target,
        selectable: false,
        zIndex: marks.get(e.id) === 'traced' ? 2 : 1,
        data: { edge: e, mark: marks.get(e.id) },
      })),
    [layout, marks],
  );
  const isFactory = (id: string | null) => !!id && kinds.get(id)?.kind === 'factory';
  const valid = (c: Connection | Edge) =>
    isFactory(c.source) && isFactory(c.target) && c.source !== c.target;

  return (
    <div className="flow-canvas" data-testid="world-canvas">
      <ReactFlow<CanvasNode, CanvasEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={false}
        nodesConnectable
        isValidConnection={valid}
        onConnect={(c) => {
          if (!valid(c)) return;
          const item = handleItem(c.sourceHandle) ?? handleItem(c.targetHandle);
          connect(kinds.get(c.source)!.ref, kinds.get(c.target)!.ref, item);
        }}
        onNodeClick={(_, node) => {
          if (kinds.get(node.id)?.kind === 'factory')
            setSelected((s) => (s === node.id ? undefined : node.id));
        }}
        onPaneClick={() => setSelected(undefined)}
        zoomOnDoubleClick={false}
        minZoom={0.05}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls showInteractive={false} showFitView={false}>
          <FitButton layout={layout} />
        </Controls>
        <Refit layout={layout} />
      </ReactFlow>
    </div>
  );
}

/** Room around the drawing when it is fitted, px. */
const FIT_PAD = 16;

/**
 * The view that shows the whole drawing (B3): ELK's own bounds, edge labels
 * included, centred in the canvas and never zoomed past 1.
 */
export function fitLayout(
  layout: Pick<WorldLayout, 'width' | 'height'>,
  width: number,
  height: number,
): { x: number; y: number; zoom: number } {
  const zoom = Math.max(
    0.05,
    Math.min(
      FIT.maxZoom,
      (width - 2 * FIT_PAD) / Math.max(1, layout.width),
      (height - 2 * FIT_PAD) / Math.max(1, layout.height),
    ),
  );
  return {
    zoom,
    x: (width - layout.width * zoom) / 2,
    y: (height - layout.height * zoom) / 2,
  };
}

/** The zoom a new layout never opens below (UX-9): 12 px card text stays 9 px. */
export const TEXT_FLOOR = 0.75;

/**
 * The view a new layout opens at (UX-9): fitted, but never so far out that
 * its text drops below the floor. A world too big for that opens at its
 * top-left (inputs) corner; the Fit button still shows it all.
 */
export function openingView(
  layout: Pick<WorldLayout, 'width' | 'height'>,
  width: number,
  height: number,
): { x: number; y: number; zoom: number } {
  const fit = fitLayout(layout, width, height);
  if (fit.zoom >= TEXT_FLOOR) return fit;
  const zoom = Math.min(FIT.maxZoom, TEXT_FLOOR);
  const at = (room: number, size: number) =>
    size * zoom + 2 * FIT_PAD <= room ? (room - size * zoom) / 2 : FIT_PAD;
  return { zoom, x: at(width, layout.width), y: at(height, layout.height) };
}

/**
 * Fits the view to each new layout, such as a group collapsing or expanding
 * (B3), and once the canvas has its size. It reads the layout's bounds, not
 * React Flow's node list, which can still hold the previous layout's nodes.
 */
function Refit({ layout }: { layout: WorldLayout }) {
  const flow = useReactFlow();
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  const sized = width > 0 && height > 0;
  useEffect(() => {
    if (sized) void flow.setViewport(openingView(layout, width, height));
    // Only a new layout or the canvas's first size refits, not each resize.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow, layout, sized]);
  return null;
}

/** Shows the whole world, its edge labels included (B3). */
function FitButton({ layout }: { layout: WorldLayout }) {
  const flow = useReactFlow();
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  return (
    <ControlButton
      onClick={() => void flow.setViewport(fitLayout(layout, width, height), { duration: 200 })}
      title="Fit the whole world"
      aria-label="Fit the whole world"
    >
      <FitIcon />
    </ControlButton>
  );
}
