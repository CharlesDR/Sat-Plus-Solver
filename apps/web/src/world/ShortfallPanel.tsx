/**
 * The shortfall panel (A92): what new demand asks of built factories held at
 * their size, one row per held factory and part. "Compare fixes" re-solves the
 * world in the worker twice, scaled up and with a new site; "Scale up" lifts
 * the hold on the factory and the held factories upstream of it, and "Add
 * site" makes a new factory that covers the remainder.
 */
import { formatRate as fmt } from '@sps/solver';
import type { Shortfall, World } from '@sps/world';
import { useState } from 'react';
import type { SolveOutcome } from '../solver/client';
import type { Catalog, ShortfallOption, WorldAction, WorldSummary } from '../solver/protocol';
import type { WorldStore } from '../store';

type Name = (id: string) => string;

type Compared =
  | { kind: 'solving' }
  | { kind: 'done'; scaleUp: ShortfallOption; newSite: ShortfallOption }
  | { kind: 'error'; message: string };

const list = (names: string[]) =>
  names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

const rowKey = (s: Shortfall) => `${s.factory}\n${s.item}`;

export function ShortfallPanel(props: {
  world: World;
  summary: WorldSummary;
  store: WorldStore;
  catalog: Catalog;
  itemName: Name;
  run(action: WorldAction): Promise<SolveOutcome | null>;
}) {
  const { world, summary, store, catalog, itemName, run } = props;
  const nodeName = (id: string) => catalog.nodes.find((n) => n.id === id)?.label ?? id;
  const factoryName = (id: string) => world.factories.find((f) => f.id === id)?.name ?? id;
  const names = (ids: string[]) => list(ids.map(factoryName));
  const grow = world.defaults.builtFactories === 'grow';
  // Results belong to the world they were solved for.
  const [compared, setCompared] = useState<{ world: World; rows: Map<string, Compared> }>();
  const result = (s: Shortfall) =>
    compared?.world === world ? compared.rows.get(rowKey(s)) : undefined;
  const siteName = (s: Shortfall) => `${itemName(s.item)} site`;

  const compare = (s: Shortfall) => {
    const key = rowKey(s);
    const put = (c: Compared) =>
      setCompared((prev) => {
        const rows = new Map(prev?.world === world ? prev.rows : []);
        rows.set(key, c);
        return { world, rows };
      });
    put({ kind: 'solving' });
    run({ kind: 'preview-shortfall', factoryId: s.factory, item: s.item, site: siteName(s) }).then(
      (o) =>
        put(
          o?.shortfallPreview
            ? { kind: 'done', ...o.shortfallPreview }
            : { kind: 'error', message: 'Interrupted by an edit.' },
        ),
      (e: unknown) => put({ kind: 'error', message: (e as Error).message }),
    );
  };

  return (
    <div className="shortfalls">
      <div className="row" role="radiogroup" aria-label="Built factories">
        <span data-help="built-factories">Built factories:</span>
        <label className="check" data-help="built-hold">
          <input
            type="radio"
            name="built-factories"
            checked={!grow}
            onChange={() => store.getState().setBuiltFactories('hold')}
          />
          Hold their size
        </label>
        <label className="check" data-help="built-grow">
          <input
            type="radio"
            name="built-factories"
            checked={grow}
            onChange={() => store.getState().setBuiltFactories('grow')}
          />
          Grow with demand
        </label>
      </div>
      {summary.shortfalls.length === 0 ? (
        <p className="hint">
          {grow
            ? 'Built factories grow with demand, so nothing is held short.'
            : 'Every built factory keeps up with what its links pull.'}
        </p>
      ) : (
        <ul className="shortfall-list">
          {summary.shortfalls.map((s) => {
            const c = result(s);
            return (
              <li key={rowKey(s)} data-factory={s.factory} data-item={s.item}>
                <p>
                  <strong>{factoryName(s.factory)}</strong> is short{' '}
                  <span className="num">{fmt(s.missing)}</span>/min of {itemName(s.item)}: it holds{' '}
                  <span className="num">{fmt(s.holds)}</span>/min for {names(s.consumers)}
                  {s.downstream.length ? `, which ${names(s.downstream)} also feel` : ''}.
                  {s.upstream.length ? ` Scaling up drags along ${names(s.upstream)}.` : ''}
                </p>
                <div className="row">
                  <button
                    type="button"
                    data-help="shortfall-compare"
                    disabled={c?.kind === 'solving'}
                    onClick={() => compare(s)}
                  >
                    Compare fixes
                  </button>
                  <button
                    type="button"
                    data-help="shortfall-scale-up"
                    onClick={() => store.getState().scaleUp([s.factory, ...s.upstream])}
                  >
                    Scale up
                  </button>
                  <button
                    type="button"
                    data-help="shortfall-add-site"
                    onClick={() => store.getState().addSite(s.item, s.consumers, siteName(s))}
                  >
                    Add site
                  </button>
                </div>
                {c?.kind === 'solving' && <p className="hint">Solving both fixes…</p>}
                {c?.kind === 'error' && <p className="hint">{c.message}</p>}
                {c?.kind === 'done' && (
                  <dl className="shortfall-compare">
                    <dt>Scale up</dt>
                    <dd>
                      <Option o={c.scaleUp} names={names} nodeName={nodeName} />
                    </dd>
                    <dt>New site</dt>
                    <dd>
                      <Option
                        o={c.newSite}
                        names={(ids) => names(ids.filter(isOld(world)))}
                        nodeName={nodeName}
                      />
                    </dd>
                  </dl>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Factories already in the world; the new site's preview id is not. */
const isOld = (world: World) => (id: string) => world.factories.some((f) => f.id === id);

function Option(props: { o: ShortfallOption; names(ids: string[]): string; nodeName: Name }) {
  const { o } = props;
  const grows = props.names(o.grows);
  return (
    <span className="num">
      +{fmt(Math.max(0, o.machines))} machines, +{fmt(Math.max(0, o.consumptionMW))} MW, +
      {fmt(Math.max(0, o.nodes))} nodes
      {grows ? `; grows ${grows}` : ''}
      {o.overPool.length
        ? `; over the node pool: ${o.overPool.map(props.nodeName).join(', ')}`
        : ''}
      {o.stillShort > 1e-9 ? `; still ${fmt(o.stillShort)}/min short` : ''}.
    </span>
  );
}
