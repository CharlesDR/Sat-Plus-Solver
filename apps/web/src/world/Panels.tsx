/**
 * The world view's panels (PLAN M8, §4.5): item ledger (save-wide, per group
 * or per factory), factory table, link table, power, node pool and groups.
 */
import { formatRate as fmt, type PowerSummary } from '@sps/solver';
import { StatusChip } from '../ui/StatusChip';
import { groupAncestors, type World } from '@sps/world';
import { parentOptions } from '../nest/nest';
import { useState, type ReactNode } from 'react';
import type { Catalog, WorldSummary } from '../solver/protocol';
import type { WorldStore } from '../store';
import {
  ledgerFor,
  ledgerScopes,
  powerRows,
  scopeKey,
  type LedgerScope,
  type PowerRow,
} from './viewModel';

type Name = (id: string) => string;

function Table(props: {
  label: string;
  head: string[];
  textColumns?: number;
  children: ReactNode;
}) {
  const { label, head, textColumns = 1, children } = props;
  return (
    <table aria-label={label}>
      <caption>{label}</caption>
      <thead>
        <tr>
          {head.map((h, c) => (
            <th key={h || c} scope="col" className={c < textColumns ? 'text' : 'num'}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

const num = (v: number) => <td className="num">{fmt(v)}</td>;

export function LedgerPanel(props: {
  summary: WorldSummary;
  itemName: Name;
  traceItem: string | undefined;
  onTrace(item: string | undefined): void;
}) {
  const { summary, itemName, traceItem, onTrace } = props;
  const [scope, setScope] = useState<LedgerScope>({ kind: 'world' });
  const scopes = ledgerScopes(summary);
  const key = scopeKey(scope);
  const rows = ledgerFor(summary, scope);
  return (
    <div>
      <label className="inline">
        Ledger scope{' '}
        <select
          value={key}
          onChange={(e) =>
            setScope(scopes.find((s) => scopeKey(s.scope) === e.target.value)!.scope)
          }
        >
          {scopes.map((s) => (
            <option key={scopeKey(s.scope)} value={scopeKey(s.scope)}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <Table
        label="Item ledger"
        head={[
          'Item',
          'Produced',
          'Consumed',
          'Target',
          'Imported',
          'Exported',
          'Surplus',
          'Unmet',
          '',
        ]}
      >
        {rows.map((r) => (
          <tr key={r.item} data-item={r.item} className={r.item === traceItem ? 'selected' : ''}>
            <td className="text">{itemName(r.item)}</td>
            {num(r.produced)}
            {num(r.consumed)}
            {num(r.target)}
            {num(r.imported)}
            {num(r.exported)}
            {num(r.surplus)}
            <td className={r.unmet > 1e-6 ? 'num warning' : 'num'}>{fmt(r.unmet)}</td>
            <td className="num">
              <button
                type="button"
                aria-pressed={r.item === traceItem}
                aria-label={`Trace ${itemName(r.item)}`}
                onClick={() => onTrace(r.item === traceItem ? undefined : r.item)}
              >
                Trace
              </button>
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

const rates = (xs: readonly { item: string; rate: number }[], name: Name) =>
  xs.map((x) => `${fmt(x.rate)} ${name(x.item)}`).join(', ');

export function FactoriesPanel(props: {
  world: World;
  summary: WorldSummary;
  store: WorldStore;
  itemName: Name;
  onOpen(id: string): void;
}) {
  const { world, summary, store, itemName, onOpen } = props;
  const actions = store.getState();
  const solved = new Map(summary.factories.map((f) => [f.id, f]));
  return (
    <div>
      <Table
        label="Factories"
        textColumns={8}
        head={[
          'Name',
          'Group',
          'Inside',
          'Status',
          'Targets',
          'Link demand',
          'Imports',
          'Exports',
          'Draw MW',
          'Gen MW',
          'Nodes',
          'Machines',
          '',
        ]}
      >
        {world.factories.map((f) => {
          const r = solved.get(f.id);
          const demand = r?.request.demand ?? [];
          const imported = (r?.ledger ?? [])
            .filter((x) => x.imported > 1e-6 || x.unmet > 1e-6)
            .map((x) => ({ item: x.item, rate: x.imported + x.unmet }));
          const exported = (r?.ledger ?? [])
            .filter((x) => x.exported > 1e-6)
            .map((x) => ({ item: x.item, rate: x.exported }));
          return (
            <tr key={f.id} data-factory={f.id}>
              <td className="text">
                <input
                  aria-label={`Name of ${f.name}`}
                  value={f.name}
                  onChange={(e) => actions.renameFactory(f.id, e.target.value)}
                />
              </td>
              <td className="text">
                <select
                  aria-label={`Group of ${f.name}`}
                  value={f.groupId ?? ''}
                  disabled={f.parentId !== undefined}
                  title={
                    f.parentId !== undefined ? 'A sub-factory shows inside its parent.' : undefined
                  }
                  onChange={(e) => actions.setFactoryGroup(f.id, e.target.value || undefined)}
                >
                  <option value="">(none)</option>
                  {world.groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </td>
              <td className="text">
                <select
                  aria-label={`Factory ${f.name} is inside`}
                  value={f.parentId ?? ''}
                  onChange={(e) => {
                    try {
                      actions.setFactoryParent(f.id, e.target.value || undefined);
                    } catch {
                      // The list never offers a cycle; a stale choice changes nothing.
                    }
                  }}
                >
                  <option value="">(top level)</option>
                  {parentOptions(world, f.id).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </td>
              <td className={`text status ${r?.status ?? ''}`} data-testid="factory-status">
                {r ? <StatusChip status={r.status} /> : '…'}
              </td>
              <td className="text">{rates(f.request.targets, itemName)}</td>
              <td className="text" data-testid="link-demand">
                {rates(demand, itemName)}
              </td>
              <td className="text">{rates(imported, itemName)}</td>
              <td className="text">{rates(exported, itemName)}</td>
              {num(r?.power.consumptionMW ?? 0)}
              {num(r?.power.generationMW ?? 0)}
              {num((r?.nodes ?? []).reduce((s, n) => s + n.used, 0))}
              {num(r?.machines ?? 0)}
              <td className="num actions">
                <button type="button" onClick={() => onOpen(f.id)} aria-label={`Open ${f.name}`}>
                  Open
                </button>
                <button
                  type="button"
                  onClick={() => actions.removeFactory(f.id)}
                  aria-label={`Delete ${f.name}`}
                >
                  Delete
                </button>
              </td>
            </tr>
          );
        })}
      </Table>
    </div>
  );
}

export function LinksPanel(props: {
  world: World;
  summary: WorldSummary;
  store: WorldStore;
  itemName: Name;
  onEdit(linkId: string): void;
  onAdd(): void;
}) {
  const { world, summary, store, itemName, onEdit, onAdd } = props;
  const factory = new Map(world.factories.map((f) => [f.id, f.name]));
  const solved = new Map(summary.links.map((l) => [l.id, l]));
  return (
    <div>
      <button type="button" onClick={onAdd} disabled={world.factories.length < 2}>
        Add link
      </button>
      <Table
        label="Links"
        textColumns={4}
        head={[
          'From',
          'To',
          'Item',
          'Mode',
          'Requested',
          'Delivered',
          'Used',
          'Short',
          'Transport',
          'Belts/pipes',
          '',
        ]}
      >
        {world.links.map((l) => {
          const r = solved.get(l.id);
          const t = l.transport;
          return (
            <tr key={l.id} data-link={l.id}>
              <td className="text">{factory.get(l.from) ?? l.from}</td>
              <td className="text">{factory.get(l.to) ?? l.to}</td>
              <td className="text">{itemName(l.item)}</td>
              <td className="text">
                {l.mode.kind === 'fixed' ? `fixed ${fmt(l.mode.rate)}` : 'pull'}
              </td>
              {num(r?.requested ?? 0)}
              {num(r?.delivered ?? 0)}
              {num(r?.used ?? 0)}
              <td className={(r?.short ?? 0) > 1e-6 ? 'num warning' : 'num'}>
                {fmt(r?.short ?? 0)}
              </td>
              <td className="num">
                {t ? `${t.kind}${t.tier !== undefined ? ` Mk.${t.tier}` : ''}` : ''}
              </td>
              <td className="num">{r?.carriers ?? ''}</td>
              <td className="num actions">
                <button type="button" onClick={() => onEdit(l.id)}>
                  Edit
                </button>
                <button type="button" onClick={() => store.getState().removeLink(l.id)}>
                  Delete
                </button>
              </td>
            </tr>
          );
        })}
      </Table>
    </div>
  );
}

function powerCells(p: PowerSummary) {
  return (
    <>
      {num(p.consumptionMW)}
      {num(p.generationMW)}
      {num(p.netMW)}
    </>
  );
}

const POWER_HEAD = ['', 'Draw MW', 'Generation MW', 'Net MW'];

export function PowerPanel(props: {
  world: World;
  summary: WorldSummary;
  busy: boolean;
  onSizePower(factoryId: string): void;
}) {
  const { world, summary, busy, onSizePower } = props;
  const { factories, groups, total } = powerRows(summary);
  const [plant, setPlant] = useState('');
  const chosen = world.factories.some((f) => f.id === plant) ? plant : world.factories[0]?.id;
  const row = (r: PowerRow, total = false) => (
    // data-draw carries the unrounded draw, so the total can be checked
    // against its rows without the cells' rounding.
    <tr
      key={r.key}
      data-power={r.key}
      data-draw={r.power.consumptionMW}
      className={total ? 'total' : ''}
    >
      <td className="text">{r.label}</td>
      {powerCells(r.power)}
    </tr>
  );
  return (
    <div>
      <Table label="Power by factory" head={['Factory', ...POWER_HEAD.slice(1)]}>
        {factories.map((r) => row(r))}
        {row(total, true)}
      </Table>
      {groups.length > 0 && (
        <Table label="Power by group" head={['Group', ...POWER_HEAD.slice(1)]}>
          {groups.map((r) => row(r))}
        </Table>
      )}
      <p data-testid="power-balance">
        {summary.power.deficitMW > 1e-6
          ? `Deficit: ${fmt(summary.power.deficitMW)} MW on the single grid.`
          : 'Power is balanced or in surplus on the single grid.'}
      </p>
      <form
        className="controls row"
        onSubmit={(e) => {
          e.preventDefault();
          if (chosen) onSizePower(chosen);
        }}
      >
        <label>
          Power plant
          <select value={chosen ?? ''} onChange={(e) => setPlant(e.target.value)}>
            {world.factories.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={!chosen || busy}>
          Size power plant
        </button>
        <span className="hint">Sets the plant's MW target so net power is zero.</span>
      </form>
    </div>
  );
}

export function NodesPanel(props: { world: World; summary: WorldSummary; catalog: Catalog }) {
  const { world, summary, catalog } = props;
  const [all, setAll] = useState(false);
  const label = new Map(catalog.nodes.map((n) => [n.id, n.label]));
  const factory = new Map(world.factories.map((f) => [f.id, f.name]));
  const rows = summary.nodePool.filter((n) => all || n.used > 0);
  return (
    <div>
      <label className="check inline">
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show
        unused node classes
      </label>
      <Table
        label="Node pool"
        head={['Node', 'Map pool', 'Used', 'By factory', '']}
        textColumns={1}
      >
        {rows.map((n) => (
          <tr key={n.node} className={n.overAllocated ? 'over' : ''}>
            <td className="text">{label.get(n.node) ?? n.node}</td>
            {num(n.pool)}
            {num(n.used)}
            <td className="num">
              {n.byFactory
                .map((u) => `${factory.get(u.factory) ?? u.factory} ${fmt(u.used)}`)
                .join(', ')}
            </td>
            <td className="num warning">{n.overAllocated ? 'over-allocated' : ''}</td>
          </tr>
        ))}
      </Table>
      {rows.length === 0 && <p className="hint">No nodes in use.</p>}
    </div>
  );
}

export function GroupsPanel(props: { world: World; summary: WorldSummary; store: WorldStore }) {
  const { world, summary, store } = props;
  const actions = store.getState();
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();
  const members = new Map(summary.groups.map((g) => [g.id, g.factories.length]));
  const attempt = (f: () => void) => {
    try {
      f();
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div>
      <form
        className="controls row"
        onSubmit={(e) => {
          e.preventDefault();
          actions.addGroup(name);
          setName('');
        }}
      >
        <label>
          New group name
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button type="submit">Add group</button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <Table label="Groups" head={['Name', 'Inside', 'Factories', 'Collapsed', '']} textColumns={2}>
        {world.groups.map((g) => (
          <tr key={g.id} data-group={g.id}>
            <td className="text">
              <input
                aria-label={`Name of group ${g.name}`}
                value={g.name}
                onChange={(e) => actions.renameGroup(g.id, e.target.value)}
              />
            </td>
            <td className="text">
              <select
                aria-label={`Parent of ${g.name}`}
                value={g.parentId ?? ''}
                onChange={(e) =>
                  attempt(() => actions.setGroupParent(g.id, e.target.value || undefined))
                }
              >
                <option value="">(top level)</option>
                {world.groups
                  .filter((p) => p.id !== g.id && !groupAncestors(world, p.id).includes(g.id))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </td>
            {num(members.get(g.id) ?? 0)}
            <td className="num">
              <input
                type="checkbox"
                aria-label={`Collapse ${g.name}`}
                checked={g.collapsed}
                onChange={(e) => actions.setGroupCollapsed(g.id, e.target.checked)}
              />
            </td>
            <td className="num">
              <button
                type="button"
                aria-label={`Delete group ${g.name}`}
                onClick={() => actions.removeGroup(g.id)}
              >
                Delete
              </button>
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
