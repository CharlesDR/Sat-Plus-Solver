import { byproductNodeId, importNodeId, recipeNodeId, targetNodeId } from '@sps/graph';
import { formatRate as fmt, recipeTable, type PlanSummary, type SummaryFlow } from '@sps/solver';
import { useEffect, useRef, type ReactNode } from 'react';
import type { Selection } from './selection';

/** Row selection, shared with the flowchart (rows are keyed by flowchart node id). */
interface Pick {
  selection?: Selection | undefined;
  onSelect?: ((id: string | undefined) => void) | undefined;
}

/** The plan summary, laid out like the `pnpm solve` table (same sections and numbers). */
export function SummaryTable({ plan, ...pick }: { plan: PlanSummary } & Pick) {
  const p = plan.power;
  return (
    <section className="summary" aria-label="Plan summary">
      <p data-testid="plan-status">
        Status: {plan.status} · Objective: {plan.objective}
        {plan.objectiveValue !== undefined && ` = ${fmt(plan.objectiveValue)}`}
      </p>
      {plan.diagnostics.length > 0 && (
        <ul className="diagnostics">
          {plan.diagnostics.map((d, k) => (
            <li key={k} className={d.severity}>
              {d.severity}: {d.message}
            </li>
          ))}
        </ul>
      )}
      {plan.status === 'ok' && (
        <>
          <Table
            title="Recipes"
            textColumns={2}
            {...recipeTable(plan)}
            keys={plan.recipes.map((r) => recipeNodeId(r.id))}
            {...pick}
          />
          <Flows title="Targets" rows={plan.targets} id={targetNodeId} {...pick} />
          <Flows title="Imports" rows={plan.imports} id={importNodeId} {...pick} />
          <Flows
            title="Surplus and byproducts"
            rows={plan.byproducts}
            id={byproductNodeId}
            {...pick}
          />
          {plan.nodes.length > 0 && (
            <Table
              title="Nodes"
              head={['Node', 'Used', 'Budget', 'NNE']}
              rows={plan.nodes.map((n) => [n.label, fmt(n.used), fmt(n.budget), fmt(n.nne)])}
            />
          )}
          <p data-testid="power">
            Power: {fmt(p.consumptionMW)} MW draw, {fmt(p.generationMW)} MW generated, net{' '}
            {fmt(p.netMW)} MW
          </p>
        </>
      )}
    </section>
  );
}

function Flows(props: { title: string; rows: SummaryFlow[]; id: (item: string) => string } & Pick) {
  const { title, rows, id, ...pick } = props;
  if (!rows.length) return null;
  return (
    <Table
      title={title}
      head={['Item', 'Per min']}
      rows={rows.map((r) => [r.name, fmt(r.rate)])}
      keys={rows.map((r) => id(r.item))}
      {...pick}
    />
  );
}

function Table(
  props: {
    title: string;
    head: string[];
    rows: string[][];
    textColumns?: number;
    /** Flowchart node id per row; rows are selectable when given with `onSelect`. */
    keys?: string[];
  } & Pick,
) {
  const { title, head, rows, textColumns = 1, keys, selection, onSelect } = props;
  return (
    <table aria-label={title}>
      <caption>{title}</caption>
      <thead>
        <tr>
          {head.map((h, c) => (
            <th key={h} scope="col" className={c < textColumns ? 'text' : 'num'}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, k) => {
          const key = keys?.[k];
          const cells = r.map((v, c) => (
            <td key={c} className={c < textColumns ? 'text' : 'num'}>
              {v}
            </td>
          ));
          if (key === undefined || !onSelect) return <tr key={k}>{cells}</tr>;
          return (
            <SelectableRow key={key} id={key} selection={selection} onSelect={onSelect}>
              {cells}
            </SelectableRow>
          );
        })}
      </tbody>
    </table>
  );
}

function SelectableRow(props: {
  id: string;
  selection: Selection | undefined;
  onSelect: (id: string | undefined) => void;
  children: ReactNode;
}) {
  const { id, selection, onSelect, children } = props;
  const selected = selection?.id === id;
  const ref = useRef<HTMLTableRowElement>(null);
  // A node picked in the flowchart scrolls its row into view.
  useEffect(() => {
    if (selected && selection?.from === 'graph') ref.current?.scrollIntoView({ block: 'nearest' });
  }, [selected, selection]);
  const toggle = () => onSelect(selected ? undefined : id);
  return (
    <tr
      ref={ref}
      className={selected ? 'selectable selected' : 'selectable'}
      aria-selected={selected}
      data-node={id}
      tabIndex={0}
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        }
      }}
    >
      {children}
    </tr>
  );
}
