/**
 * The world canvas (PLAN M8): factories and groups laid out by ELK in the
 * layout worker and drawn with React Flow. Expanded groups are frames around
 * their members; collapsed groups are one node. Dragging from a factory's
 * right handle to another factory's left handle starts a link. Item trace
 * dims everything that doesn't touch the traced item.
 */
import {
  layoutWorldGraph,
  worldNodeLines,
  type LayoutEngine,
  type PlacedWorldEdge,
  type PlacedWorldNode,
  type WorldGraph,
  type WorldLayout,
} from '@sps/graph';
import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
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
import { StatusChip } from '../ui/StatusChip';

/** What the canvas's nodes can ask the view to do. */
export interface CanvasActions {
  openFactory(id: string): void;
  setCollapsed(groupId: string, collapsed: boolean): void;
  /** A link drawn from one factory to another. */
  connect(from: string, to: string): void;
}

const Actions = createContext<CanvasActions | undefined>(undefined);

type Mark = 'traced' | 'dimmed' | undefined;
type WorldNodeData = { node: PlacedWorldNode; mark: Mark };
type CanvasNode = Node<WorldNodeData, 'world' | 'frame'>;
type WorldEdgeData = { edge: PlacedWorldEdge; mark: Mark };
type CanvasEdge = Edge<WorldEdgeData, 'routed'>;

const STATUS = 'Status: ';

const cls = (...xs: (string | false | undefined)[]) => xs.filter(Boolean).join(' ');

const WorldNodeView = memo(function WorldNodeView({ data }: NodeProps<CanvasNode>) {
  const actions = useContext(Actions)!;
  const n = data.node;
  const [title, ...rest] = worldNodeLines(n);
  const factory = n.kind === 'factory';
  return (
    <div
      className={cls('world-node', n.kind, n.status, n.direction, n.manual && 'manual', data.mark)}
      onDoubleClick={factory ? () => actions.openFactory(n.ref) : undefined}
    >
      <Handle type="target" position={Position.Left} isConnectable={factory} />
      <div className="flow-title" title={title}>
        {title}
      </div>
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
          onClick={() => actions.openFactory(n.ref)}
        >
          Open
        </button>
      )}
      {n.kind === 'group' && (
        <button
          type="button"
          className="nodrag link-button"
          onClick={() => actions.setCollapsed(n.ref, false)}
        >
          Expand
        </button>
      )}
      <Handle type="source" position={Position.Right} isConnectable={factory} />
    </div>
  );
});

const FrameView = memo(function FrameView({ data }: NodeProps<CanvasNode>) {
  const actions = useContext(Actions)!;
  const n = data.node;
  return (
    <div className={cls('group-frame', data.mark)}>
      <div className="group-header">
        <span className="flow-title">{n.label}</span>
        <button
          type="button"
          className="nodrag link-button"
          onClick={() => actions.setCollapsed(n.ref, true)}
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
  const { points, label, kind, short } = data.edge;
  const path = points.map((p, k) => `${k ? 'L' : 'M'}${p.x},${p.y}`).join(' ');
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
          {label.lines.map((l) => (
            <div key={l}>{l}</div>
          ))}
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
          data: { node: n, mark: marks.get(n.id) },
          draggable: false,
          selectable: false,
          connectable: factory,
          ariaLabel: frame
            ? `Group: ${n.label}`
            : `${n.kind === 'stub' ? 'Stub' : n.kind === 'group' ? 'Group' : 'Factory'}: ${worldNodeLines(n).join(', ')}`,
        };
      }),
    [layout, marks],
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
          if (valid(c)) connect(kinds.get(c.source)!.ref, kinds.get(c.target)!.ref);
        }}
        zoomOnDoubleClick={false}
        minZoom={0.05}
        fitView
        fitViewOptions={FIT}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls showInteractive={false} />
        <Refit layout={layout} />
      </ReactFlow>
    </div>
  );
}

/** Refits the view when the layout changes. */
function Refit({ layout }: { layout: WorldLayout }) {
  const flow = useReactFlow();
  useEffect(() => {
    void flow.fitView(FIT);
  }, [flow, layout]);
  return null;
}
