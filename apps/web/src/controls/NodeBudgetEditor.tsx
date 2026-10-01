import type { Factory, World } from '@sps/world';
import { useState } from 'react';
import type { CatalogNode } from '../solver/protocol';

interface Props {
  world: World;
  factory: Factory;
  nodes: CatalogNode[];
  /** Node usage of the current plan, by node id. */
  usage: ReadonlyMap<string, number>;
  onChange(budget: Factory['nodeBudget']): void;
}

/**
 * The factory's node budget: up to the whole map pool, or explicit caps per
 * node class (a missing cap is 0). A budget below what the plan needs gives
 * the solver's infeasibility diagnostic, naming the nodes it would need.
 */
export function NodeBudgetEditor({ world, factory, nodes, usage, onChange }: Props) {
  const [search, setSearch] = useState('');
  const pool = (n: CatalogNode) => world.nodePool[n.id] ?? n.count;
  const budget = factory.nodeBudget;
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = nodes.filter(
    (n) =>
      words.every((w) => n.label.toLowerCase().includes(w)) &&
      (words.length > 0 || budget === 'pool' || pool(n) > 0 || (budget[n.id] ?? 0) > 0),
  );

  return (
    <fieldset className="nodes" aria-label="Node budget">
      <div className="row">
        <label className="check">
          <input
            type="radio"
            name={`budget-${factory.id}`}
            checked={budget === 'pool'}
            onChange={() => onChange('pool')}
          />
          Whole map pool
        </label>
        <label className="check">
          <input
            type="radio"
            name={`budget-${factory.id}`}
            checked={budget !== 'pool'}
            onChange={() => onChange(Object.fromEntries(nodes.map((n) => [n.id, pool(n)])))}
          />
          Explicit caps
        </label>
        {budget !== 'pool' && (
          <button
            type="button"
            disabled={usage.size === 0}
            onClick={() =>
              onChange(Object.fromEntries(nodes.map((n) => [n.id, usage.get(n.id) ?? 0])))
            }
          >
            Set caps to current usage
          </button>
        )}
      </div>
      {budget !== 'pool' && (
        <>
          <label>
            Search nodes
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <table aria-label="Node caps">
            <thead>
              <tr>
                <th scope="col" className="text">
                  Node
                </th>
                <th scope="col" className="num">
                  Map pool
                </th>
                <th scope="col" className="num">
                  Used
                </th>
                <th scope="col" className="num">
                  Cap
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((n) => (
                <tr key={n.id}>
                  <td className="text">{n.label}</td>
                  <td className="num">{pool(n)}</td>
                  <td className="num">{usage.get(n.id)?.toFixed(2) ?? ''}</td>
                  <td className="num">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      aria-label={`Cap for ${n.label}`}
                      value={budget[n.id] ?? 0}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (e.target.value.trim() === '' || !Number.isFinite(v) || v < 0) return;
                        onChange({ ...budget, [n.id]: v });
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </fieldset>
  );
}
