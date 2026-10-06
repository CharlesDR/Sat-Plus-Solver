import type { Factory, World } from '@sps/world';
import { formatRate } from '@sps/solver';
import type { CatalogResource } from '../solver/protocol';
import { mapMax, setEnabled, setMax } from './resourceLimits';

interface Props {
  world: World;
  factory: Factory;
  resources: CatalogResource[];
  /** What the current plan extracts, by resource id. */
  usage: ReadonlyMap<string, number>;
  onChange(resources: Factory['resources']): void;
  /** "Allocate remaining" (§4.4): limits = what the map can extract minus the other factories' use. */
  onAllocateRemaining?: () => void;
}

/**
 * The factory's raw resources (A33): one row per resource, whatever mines
 * it. A checkbox turns it on or off; node-limited resources take a maximum
 * rate (empty = up to the map's node pool). Unlimited ones, like Water, only
 * turn on and off.
 */
export function ResourceLimitsEditor(props: Props) {
  const { world, factory, resources, usage, onChange, onAllocateRemaining } = props;
  const limits = factory.resources;
  return (
    <fieldset className="nodes" aria-label="Resources">
      <div className="row">
        {onAllocateRemaining && (
          <button type="button" onClick={onAllocateRemaining}>
            Allocate remaining
          </button>
        )}
        <button
          type="button"
          disabled={Object.keys(limits).length === 0}
          onClick={() => onChange({})}
        >
          Clear limits
        </button>
      </div>
      <table aria-label="Resource limits">
        <thead>
          <tr>
            <th scope="col" className="text">
              Use
            </th>
            <th scope="col" className="text">
              Resource
            </th>
            <th scope="col" className="num">
              Used
            </th>
            <th scope="col" className="num">
              Max per min
            </th>
            <th scope="col" className="num">
              Map max
            </th>
          </tr>
        </thead>
        <tbody>
          {resources.map((r) => {
            const limit = limits[r.id];
            const on = limit?.enabled !== false;
            const unit = r.fluid ? 'm³/min' : '/min';
            const max = mapMax(r, world.nodePool);
            return (
              <tr key={r.id} className={on ? undefined : 'off'}>
                <td className="text">
                  <input
                    type="checkbox"
                    aria-label={`Use ${r.name}`}
                    checked={on}
                    onChange={(e) => onChange(setEnabled(limits, r.id, e.target.checked))}
                  />
                </td>
                <td className="text">{r.name}</td>
                <td className="num">{usage.has(r.id) ? formatRate(usage.get(r.id)!) : ''}</td>
                <td className="num">
                  {r.limited ? (
                    <>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        placeholder="any"
                        aria-label={`Limit for ${r.name}`}
                        disabled={!on}
                        value={limit?.max ?? ''}
                        onChange={(e) => {
                          const text = e.target.value.trim();
                          if (text === '') return onChange(setMax(limits, r.id, undefined));
                          const v = Number(text);
                          if (Number.isFinite(v) && v >= 0) onChange(setMax(limits, r.id, v));
                        }}
                      />{' '}
                      <span className="unit">{unit}</span>
                    </>
                  ) : (
                    <span>unlimited</span>
                  )}
                </td>
                <td className="num">{max === undefined ? '' : formatRate(max)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </fieldset>
  );
}
