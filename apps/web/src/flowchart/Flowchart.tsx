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
import { memo, useEffect, useMemo } from 'react';
import type { Selection } from '../selection';
import { useLayout } from './useLayout';

type FlowNodeData = { node: PlacedNode };
type FlowchartNode = Node<FlowNodeData, 'flow'>;
type FlowEdgeData = { edge: PlacedEdge; active: boolean };
type FlowchartEdge = Edge<FlowEdgeData, 'routed'>;

const KIND_LABEL = {
  recipe: 'Recipe',
  resource: 'Resource node',
  import: 'Import',
  missing: 'Missing input',
  target: 'Target',
  byproduct: 'Byproduct',
} as const;

const FlowNodeView = memo(function FlowNodeView({ data }: NodeProps<FlowchartNode>) {
  const { title, details } = data.node.text;
  return (
    <div className={`flow-node ${data.node.kind}`}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      {/* Lines come wrapped from the layout, which sized the node to fit them. */}
      <div className="flow-title">{title.join('\n')}</div>
      {details.length > 0 && <div className="flow-detail">{details.join('\n')}</div>}
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
/** Fill the canvas, but don't blow a small plan up past 1.5×. */
const FIT = { padding: 0.02, maxZoom: 1.5 };
const edgeTypes = { routed: RoutedEdge };

export function Flowchart(props: {
  engine: LayoutEngine;
  graph: FactoryGraph;
  selection: Selection | undefined;
  onSelect: (id: string | undefined) => void;
}) {
  const state = useLayout(props.engine, props.graph);
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
          <Canvas layout={state.layout} selection={props.selection} onSelect={props.onSelect} />
        </ReactFlowProvider>
      )}
    </section>
  );
}

function Canvas(props: {
  layout: FactoryLayout;
  selection: Selection | undefined;
  onSelect: (id: string | undefined) => void;
}) {
  const { layout, selection, onSelect } = props;
  const selected = selection?.id;
  const nodes = useMemo<FlowchartNode[]>(
    () =>
      layout.nodes.map((n) => ({
        id: n.id,
        type: 'flow',
        position: { x: n.x, y: n.y },
        width: n.width,
        height: n.height,
        style: { width: n.width, height: n.height },
        data: { node: n },
        selected: n.id === selected,
        draggable: false,
        connectable: false,
        ariaLabel: `${KIND_LABEL[n.kind]}: ${nodeLines(n).join(', ')}`,
      })),
    [layout, selected],
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
          data: { edge: e, active },
        };
      }),
    [layout, selected],
  );
  return (
    // As tall as the drawing needs at full width, within the CSS min/max height.
    <div
      className="flow-canvas"
      data-testid="flowchart"
      style={{ aspectRatio: `${layout.width} / ${layout.height}` }}
    >
      <ReactFlow<FlowchartNode, FlowchartEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        onNodeClick={(_, n) => onSelect(n.id === selected ? undefined : n.id)}
        onPaneClick={() => onSelect(undefined)}
        minZoom={0.05}
        fitView
        fitViewOptions={FIT}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls showInteractive={false} />
        <Follow layout={layout} selection={selection} />
      </ReactFlow>
    </div>
  );
}

/** Refits the view to a new plan, and centers a node picked in the table. */
function Follow({
  layout,
  selection,
}: {
  layout: FactoryLayout;
  selection: Selection | undefined;
}) {
  const flow = useReactFlow();
  useEffect(() => {
    void flow.fitView(FIT);
  }, [flow, layout]);
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
