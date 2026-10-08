/**
 * Sub-factories in the factory view (A49–A53): which factory this one sits
 * inside, its sub-factories with their state, "Add sub-factory", and its
 * totals on its own and with everything below it.
 */
import type { Factory, World } from '@sps/world';
import { BUILD_STATE } from '../build/build';
import type { FactorySummary } from '../solver/protocol';
import { StatusChip } from '../ui/StatusChip';
import { parentOptions, totalsText } from './nest';

export function NestPanel(props: {
  world: World;
  factory: Factory;
  /** The factories as solved in the world, once solved. */
  solved: readonly FactorySummary[] | undefined;
  onOpen(id: string): void;
  onAdd(): void;
  onMove(parentId: string | undefined): void;
}) {
  const { world, factory, solved, onOpen } = props;
  const mine = solved?.find((f) => f.id === factory.id);
  const children = world.factories.filter((f) => f.parentId === factory.id);
  return (
    <div className="nest-bar" data-testid="nest-bar">
      <div className="nest-head">
        <label>
          Inside{' '}
          <select
            aria-label="Inside factory"
            value={factory.parentId ?? ''}
            onChange={(e) => props.onMove(e.target.value || undefined)}
          >
            <option value="">(top level)</option>
            {parentOptions(world, factory.id).map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={props.onAdd}>
          Add sub-factory
        </button>
      </div>
      {children.length > 0 && (
        <>
          <ul className="nest-children" aria-label="Sub-factories">
            {children.map((c) => {
              const r = solved?.find((f) => f.id === c.id);
              const build = r?.subtreeBuild ?? r?.build?.state;
              return (
                <li key={c.id}>
                  <button type="button" className="link-button" onClick={() => onOpen(c.id)}>
                    {c.name}
                  </button>
                  {r && <StatusChip status={r.status} />}
                  {build && (
                    <span className={`status-chip ${BUILD_STATE[build].tone}`}>
                      {BUILD_STATE[build].label}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {mine?.subtree && (
            <p className="hint" data-testid="nest-totals">
              This factory: {totalsText(mine)}. With sub-factories: {totalsText(mine.subtree)}.
            </p>
          )}
        </>
      )}
    </div>
  );
}
