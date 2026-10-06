import {
  byproductNodeId,
  importNodeId,
  missingNodeId,
  recipeNodeId,
  targetNodeId,
} from '@sps/graph';
import { formatRate as fmt, recipeTable, type PlanSummary, type SummaryFlow } from '@sps/solver';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Selection } from './selection';
import { itemIcon } from './icons/icons';
import { StatusChip } from './ui/StatusChip';

/** Row selection, shared with the flowchart (rows are keyed by flowchart node id). */
interface Pick {
  selection?: Selection | undefined;
  onSelect?: ((id: string | undefined) => void) | undefined;
}

/** The plan summary, laid out like the `pnpm solve` table (same sections and numbers). */
export function SummaryTable({
  plan,
  missing = [],
  manual = false,
  ...pick
}: {
  plan: PlanSummary;
  /** Manual mode (A36): the plan is hand-edited arithmetic, with these inputs missing. */
  manual?: boolean;
  missing?: SummaryFlow[] | undefined;
} & Pick) {
  const p = plan.power;
  return (
    <section className="summary" aria-label="Plan summary">
      <p data-testid="plan-status">
        {manual ? (
          <>
            Status: <StatusChip status="manual" label="manual plan, not solver-checked" />
          </>
        ) : (
          <>
            Status: <StatusChip status={plan.status} /> · Objective: {plan.objective}
            {plan.objectiveValue !== undefined && ` = ${fmt(plan.objectiveValue)}`}
          </>
        )}
      </p>
      {plan.status === 'ok' && (
        <>
          <Table
            title="Recipes"
            textColumns={2}
            {...recipeTable(plan)}
            keys={plan.recipes.map((r) => recipeNodeId(r.id))}
            filterable
            {...pick}
          />
          <Flows title="Targets" rows={plan.targets} id={targetNodeId} {...pick} />
          <Flows title="Missing inputs" rows={missing} id={missingNodeId} {...pick} />
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
      icons={rows.map((r) => itemIcon(r.item))}
      {...pick}
    />
  );
}

type Sort = { col: number; dir: 'ascending' | 'descending' } | undefined;

/** A number cell's value for sorting ("1,234.5", "50%", "" → NaN). */
const numeric = (v: string) => Number(v.replace(/[,%]/g, '').trim() || NaN);

function Table(
  props: {
    title: string;
    head: string[];
    rows: string[][];
    textColumns?: number;
    /** Flowchart node id per row; rows are selectable when given with `onSelect`. */
    keys?: string[];
    /** Adds a filter box above the table. */
    filterable?: boolean;
    /** An icon per row, drawn in its first cell. */
    icons?: (string | undefined)[];
  } & Pick,
) {
  const {
    title,
    head,
    rows,
    textColumns = 1,
    keys,
    selection,
    onSelect,
    filterable,
    icons,
  } = props;
  // Rows keep the plan's order until a heading is clicked: ascending, descending, then back.
  const [sort, setSort] = useState<Sort>();
  const [filter, setFilter] = useState('');
  const order = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const shown = rows
      .map((_, k) => k)
      .filter((k) => !q || rows[k]!.some((v) => v.toLowerCase().includes(q)));
    if (!sort) return shown;
    const { col, dir } = sort;
    const sign = dir === 'ascending' ? 1 : -1;
    const value = (k: number) => rows[k]![col] ?? '';
    return shown.sort((a, b) => {
      const d =
        col < textColumns
          ? value(a).localeCompare(value(b))
          : (numeric(value(a)) || 0) - (numeric(value(b)) || 0);
      return sign * d || a - b;
    });
  }, [rows, sort, filter, textColumns]);
  const cycle = (col: number) =>
    setSort((s) =>
      s?.col !== col
        ? { col, dir: 'ascending' }
        : s.dir === 'ascending'
          ? { col, dir: 'descending' }
          : undefined,
    );
  const table = (
    <table aria-label={title}>
      <caption>{title}</caption>
      <thead>
        <tr>
          {head.map((h, c) => (
            <th
              key={h}
              scope="col"
              className={c < textColumns ? 'text' : 'num'}
              aria-sort={sort?.col === c ? sort.dir : undefined}
            >
              <button
                type="button"
                className="sort"
                title={`Sort by ${h}`}
                onClick={() => cycle(c)}
              >
                {h}
              </button>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {order.map((k) => {
          const r = rows[k]!;
          const key = keys?.[k];
          const icon = icons?.[k];
          const cells = r.map((v, c) => (
            <td key={c} className={c < textColumns ? 'text' : 'num'}>
              {c === 0 && icon && (
                <img className="cell-icon" src={icon} alt="" width={20} height={20} />
              )}
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
  if (!filterable) return table;
  return (
    <div className="table-block">
      <input
        type="search"
        className="table-filter"
        aria-label={`Filter ${title.toLowerCase()}`}
        placeholder={`Filter ${title.toLowerCase()}…`}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {table}
      {order.length === 0 && <p className="hint">No row matches “{filter}”.</p>}
    </div>
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
