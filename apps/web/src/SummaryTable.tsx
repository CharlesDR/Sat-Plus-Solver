import {
  byproductNodeId,
  importNodeId,
  missingNodeId,
  productionOrder,
  recipeNodeId,
  targetNodeId,
} from '@sps/graph';
import {
  formatExact,
  recipeTable,
  starterNote,
  type PlanSummary,
  type SummaryFlow,
  type SummaryItem,
} from '@sps/solver';
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Selection } from './selection';
import type { ScopeTotalsView, ScopeView } from './stats/scope';
import { itemIcon } from './icons/icons';
import { StatusChip } from './ui/StatusChip';
import { useNumbers } from './ui/numbers';
import { useOpenPref, usePlanTab, type PlanTab } from './ui/prefs';
import { OBJECTIVE_CODES, OBJECTIVE_LABELS } from './controls/ObjectiveStack';

const NNE_TIP =
  'NNE: normal-node equivalents. An impure node counts ½, a normal node 1, a pure node 2.';

/** A table with more rows than this starts folded (Imports, UX-B). */
const FOLD_ROWS = 5;
/** The columns each filter searches: names, not numbers or chips. */
const RECIPE_FILTER = [0, 1];
const ITEM_FILTER = [0];

/** Row selection, shared with the flowchart (rows are keyed by flowchart node id). */
interface Pick {
  selection?: Selection | undefined;
  onSelect?: ((id: string | undefined) => void) | undefined;
}

/**
 * The plan summary, laid out like the `pnpm solve` table (same sections and
 * numbers in precise mode). UX-B (A78): the stats come first (Targets, Raw
 * resources, Missing inputs, Imports, Surplus, Nodes, Power), with Nodes,
 * Surplus and a long Imports table folded; the Recipes table, in production
 * order with its inputs and outputs, and the Items table share the bottom.
 */
export function SummaryTable({
  plan,
  missing = [],
  manual = false,
  scope,
  ...pick
}: {
  plan: PlanSummary;
  /** The stats scope (A81); the plan's own stats show without one, or when it is `plan`. */
  scope?: ScopeView | undefined;
  /** Manual mode (A36): the plan is hand-edited arithmetic, with these inputs missing. */
  manual?: boolean;
  missing?: SummaryFlow[] | undefined;
} & Pick) {
  const num = useNumbers();
  const p = plan.power;
  return (
    <section className="summary" aria-label="Plan summary">
      <div className="summary-head">
        <p data-testid="plan-status">
          {manual ? (
            <>
              Status: <StatusChip status="manual" label="manual plan, not solver-checked" />
            </>
          ) : (
            <>
              {/* The objective is a tooltip on the status (UX-7). */}
              Status:{' '}
              <span
                title={`Objective: ${OBJECTIVE_LABELS[plan.objective]} (${OBJECTIVE_CODES[plan.objective]})${
                  plan.objectiveValue !== undefined ? ` = ${formatExact(plan.objectiveValue)}` : ''
                }`}
              >
                <StatusChip status={plan.status} />
              </span>
            </>
          )}
        </p>
        <label className="precise-toggle" data-help="exact-numbers">
          <input
            type="checkbox"
            checked={num.precise}
            onChange={(e) => num.setPrecise(e.target.checked)}
          />
          Precise numbers
        </label>
      </div>
      {plan.status === 'ok' && (
        <>
          {starterNote(plan) && <p data-testid="starters">{starterNote(plan)}</p>}
          {scope?.kind === 'scope' ? (
            <ScopeStats totals={scope.totals} />
          ) : scope?.kind === 'pick' ? (
            <p className="hint" data-testid="scope-pick">
              Pick a recipe group or sub-factory, in the flowchart or the Recipes table, to see its
              stats.
            </p>
          ) : (
            <>
              <Flows title="Targets" rows={plan.targets} id={targetNodeId} {...pick} />
              <Flows title="Raw resources" rows={plan.extraction} />
              <Flows title="Missing inputs" rows={missing} id={missingNodeId} {...pick} />
              <Fold
                section="imports"
                title="Imports"
                count={plan.imports.length}
                fold={plan.imports.length > FOLD_ROWS}
                keys={plan.imports.map((r) => importNodeId(r.item))}
                selection={pick.selection}
              >
                <Flows title="Imports" rows={plan.imports} id={importNodeId} {...pick} />
              </Fold>
              <Fold
                section="surplus"
                title="Surplus and byproducts"
                count={plan.byproducts.length}
                keys={plan.byproducts.map((r) => byproductNodeId(r.item))}
                selection={pick.selection}
              >
                <Flows
                  title="Surplus and byproducts"
                  rows={plan.byproducts}
                  id={byproductNodeId}
                  {...pick}
                />
              </Fold>
              <Fold section="nodes" title="Nodes" count={plan.nodes.length}>
                <Table
                  title="Nodes"
                  head={['Node', 'Used', 'Budget', 'NNE']}
                  headTips={{ NNE: NNE_TIP }}
                  rows={plan.nodes.map((n) => [
                    n.label,
                    num.rate(n.used),
                    num.rate(n.budget),
                    num.rate(n.nne),
                  ])}
                  {...(num.precise
                    ? {}
                    : {
                        titles: plan.nodes.map((n) => [
                          '',
                          formatExact(n.used),
                          formatExact(n.budget),
                          formatExact(n.nne),
                        ]),
                      })}
                />
              </Fold>
              <p data-testid="power">
                Power: {num.rate(p.consumptionMW)} MW draw, {num.rate(p.generationMW)} MW generated,
                net {num.rate(p.netMW)} MW
              </p>
            </>
          )}
          <PlanTables plan={plan} {...pick} />
        </>
      )}
    </section>
  );
}

/**
 * The stats of a scope other than the open factory (A81): the same sections
 * summed over it, with links inside it netted out and Exports for what leaves.
 */
function ScopeStats({ totals }: { totals: ScopeTotalsView }) {
  const num = useNumbers();
  const p = totals.power;
  return (
    <div className="scope-stats" data-testid="scope-stats">
      <p className="hint" data-testid="scope-label">
        {totals.label}
      </p>
      <Flows title="Targets" rows={totals.targets} />
      <Flows title="Raw resources" rows={totals.extraction} />
      <Fold
        section="imports"
        title="Imports"
        count={totals.imports.length}
        fold={totals.imports.length > FOLD_ROWS}
      >
        <Flows title="Imports" rows={totals.imports} />
      </Fold>
      <Fold
        section="exports"
        title="Exports"
        count={totals.exports.length}
        fold={totals.exports.length > FOLD_ROWS}
      >
        <Flows title="Exports" rows={totals.exports} />
      </Fold>
      <Fold section="surplus" title="Surplus and byproducts" count={totals.surplus.length}>
        <Flows title="Surplus and byproducts" rows={totals.surplus} />
      </Fold>
      <Fold section="nodes" title="Nodes" count={totals.nodes.length}>
        <Table
          title="Nodes"
          head={['Node', 'Used']}
          rows={totals.nodes.map((n) => [n.label, num.rate(n.used)])}
          {...(num.precise ? {} : { titles: totals.nodes.map((n) => ['', formatExact(n.used)]) })}
        />
      </Fold>
      <p data-testid="power">
        Power: {num.rate(p.consumptionMW)} MW draw, {num.rate(p.generationMW)} MW generated, net{' '}
        {num.rate(p.netMW)} MW
      </p>
    </div>
  );
}

/** The Recipes and Items tables, one at a time behind tabs (UX-4). */
function PlanTables({ plan, ...pick }: { plan: PlanSummary } & Pick) {
  const [tab, setTab] = usePlanTab();
  const tabs: [PlanTab, string, number][] = [
    ['recipes', 'Recipes', plan.recipes.length],
    ['items', 'Items', plan.items.length],
  ];
  return (
    <div className="plan-tables">
      <div className="tabs" role="tablist" aria-label="Plan tables">
        {tabs.map(([id, label, count]) => (
          <button
            key={id}
            id={`plan-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls="plan-tab-panel"
            onClick={() => setTab(id)}
          >
            {label} <span className="tab-count">{count}</span>
          </button>
        ))}
      </div>
      <div id="plan-tab-panel" role="tabpanel" aria-labelledby={`plan-tab-${tab}`}>
        {tab === 'recipes' ? <Recipes plan={plan} {...pick} /> : <Items items={plan.items} />}
      </div>
    </div>
  );
}

/** The recipes in production order, with chips for their inputs and outputs (UX-4). */
function Recipes({ plan, ...pick }: { plan: PlanSummary } & Pick) {
  const num = useNumbers();
  const recipes = useMemo(() => productionOrder(plan.recipes), [plan.recipes]);
  const table = recipeTable({ recipes }, { io: true, format: num });
  const precise = num.precise ? undefined : recipeTable({ recipes }, { io: true }).rows;
  return (
    <Table
      title="Recipes"
      textColumns={4}
      {...table}
      keys={recipes.map((r) => recipeNodeId(r.id))}
      filterable
      filterColumns={RECIPE_FILTER}
      render={(row, col) =>
        col === 2 || col === 3 ? (
          <FlowChips flows={col === 2 ? recipes[row]!.inputs : recipes[row]!.outputs} />
        ) : undefined
      }
      {...(precise ? { titles: precise.map((r) => r.map((v, c) => (c >= 4 ? v : ''))) } : {})}
      {...pick}
    />
  );
}

/**
 * A recipe's inputs or outputs as icon chips with their rates. The name is
 * read out and shows where there is no icon; the text is the same as the CLI
 * cell ("Iron Ore 30.0, Coal 15.0").
 */
function FlowChips({ flows }: { flows: SummaryFlow[] }) {
  const num = useNumbers();
  return (
    <span className="io-chips">
      {flows.map((f, k) => {
        const icon = itemIcon(f.item);
        return (
          <Fragment key={f.item}>
            {k > 0 && <span className="visually-hidden">, </span>}
            <span className="io-chip" title={`${f.name}: ${formatExact(f.rate)}/min`}>
              {icon && <img className="io-icon" src={icon} alt="" width={20} height={20} />}
              <span className={icon ? 'visually-hidden' : 'io-name'}>{f.name}</span>{' '}
              <span className="num">{num.rate(f.rate)}</span>
            </span>
          </Fragment>
        );
      })}
    </span>
  );
}

/** Every item the plan moves, with what is made, used, brought in and left over (UX-4). */
function Items({ items }: { items: SummaryItem[] }) {
  const num = useNumbers();
  const values = (i: SummaryItem) => [i.produced, i.consumed, i.imported, i.surplus, i.demand];
  return (
    <Table
      title="Items"
      head={['Item', 'Produced', 'Consumed', 'Imported', 'Surplus', 'Target']}
      rows={items.map((i) => [i.name, ...values(i).map((v) => num.exact(v))])}
      icons={items.map((i) => itemIcon(i.item))}
      filterable
      filterColumns={ITEM_FILTER}
      {...(num.precise
        ? {}
        : { titles: items.map((i) => ['', ...values(i).map((v) => formatExact(v))]) })}
    />
  );
}

/**
 * A table that starts folded (UX-B): a closed section whose header gives the
 * count. Its open state is a preference per section. Picking one of its rows
 * in the flowchart opens it. Without `fold`, the table shows as it is.
 */
function Fold(props: {
  section: string;
  title: string;
  count: number;
  fold?: boolean;
  keys?: string[];
  selection?: Selection | undefined;
  children: ReactNode;
}) {
  const { section, title, count, fold = true, keys, selection, children } = props;
  const [open, setOpen] = useOpenPref(`plan:${section}`);
  const hit = selection?.from === 'graph' && keys?.includes(selection.id) === true;
  // Stays open once a pick opened it, until the user folds it again.
  const [reveal, setReveal] = useState(false);
  if (hit && !reveal) setReveal(true);
  if (!count) return null;
  if (!fold) return <>{children}</>;
  const shown = open || reveal || hit;
  return (
    <details
      className="fold"
      open={shown}
      onToggle={(e) => {
        const now = e.currentTarget.open;
        if (now === shown) return;
        setReveal(false);
        setOpen(now);
      }}
    >
      <summary data-help={`plan:${section}`}>
        {title} ({count})
      </summary>
      {children}
    </details>
  );
}

function Flows(
  props: { title: string; rows: SummaryFlow[]; id?: (item: string) => string } & Pick,
) {
  const { title, rows, id, ...pick } = props;
  const num = useNumbers();
  if (!rows.length) return null;
  return (
    <Table
      title={title}
      head={['Item', 'Per min']}
      // A phase target's rate is per min of its top part (A84).
      rows={rows.map((r) => [
        r.per ? `${r.name} (per min of ${r.per})` : r.name,
        num.exact(r.rate),
      ])}
      {...(id ? { keys: rows.map((r) => id(r.item)) } : {})}
      icons={rows.map((r) => itemIcon(r.item))}
      {...(num.precise ? {} : { titles: rows.map((r) => ['', formatExact(r.rate)]) })}
      {...pick}
    />
  );
}

type Sort = { col: number; dir: 'ascending' | 'descending' } | undefined;

/** A number cell's value for sorting ("1,234.5", "50%", "2.3334 (2 1/3)", "" → NaN). */
const numeric = (v: string) =>
  Number(
    v
      .replace(/ \(.*\)$/, '')
      .replace(/[,%<]/g, '')
      .trim() || NaN,
  );

/** A number cell, its exact fraction (A41) after it in a quieter style. */
function NumberText({ text }: { text: string }) {
  const m = / \((.+)\)$/.exec(text);
  if (!m) return <>{text}</>;
  return (
    <>
      {text.slice(0, m.index)} <span className="exact">({m[1]})</span>
    </>
  );
}

function Table(
  props: {
    title: string;
    head: string[];
    /** A tooltip per heading, for jargon (UX-7). */
    headTips?: Record<string, string>;
    rows: string[][];
    textColumns?: number;
    /** Flowchart node id per row; rows are selectable when given with `onSelect`. */
    keys?: string[];
    /** Adds a filter box above the table. */
    filterable?: boolean;
    /** An icon per row, drawn in its first cell. */
    icons?: (string | undefined)[];
    /** The columns the filter searches. Default: all. */
    filterColumns?: number[];
    /** A tooltip per cell, such as the exact value of a quiet number (UX-6); '' for none. */
    titles?: string[][];
    /** Draws a cell its own way; undefined keeps the text. */
    render?: (row: number, col: number) => ReactNode;
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
    headTips,
    filterColumns,
    titles,
    render,
  } = props;
  // Rows keep the plan's order until a heading is clicked: ascending, descending, then back.
  const [sort, setSort] = useState<Sort>();
  const [filter, setFilter] = useState('');
  const order = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const shown = rows
      .map((_, k) => k)
      .filter(
        (k) =>
          !q ||
          rows[k]!.some(
            (v, c) => (!filterColumns || filterColumns.includes(c)) && v.toLowerCase().includes(q),
          ),
      );
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
  }, [rows, sort, filter, textColumns, filterColumns]);
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
                title={headTips?.[h] ? `${headTips[h]} Sort by ${h}.` : `Sort by ${h}`}
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
            <td
              key={c}
              className={c < textColumns ? 'text' : 'num'}
              title={titles?.[k]?.[c] || undefined}
            >
              {c === 0 && icon && (
                <img className="cell-icon" src={icon} alt="" width={20} height={20} />
              )}
              {render?.(k, c) ?? (c < textColumns ? v : <NumberText text={v} />)}
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
        placeholder={`Filter ${title.toLowerCase()}… (/)`}
        data-shortcut={title === 'Recipes' ? 'filter-recipes' : undefined}
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
