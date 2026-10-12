import type { MinerFluidSupply } from '@sps/solver';
import type { ReactNode } from 'react';
import { useStore } from 'zustand';
import type { Catalog } from '../solver/protocol';
import {
  effectiveSettings,
  type Scope,
  type SettingKey,
  type Settings,
  type WorldStore,
} from '../store';
import { defaultWorldDefaults } from '@sps/world';
import { useOpenPref } from '../ui/prefs';
import { ObjectiveStack } from './ObjectiveStack';
import { tierOptions } from './tiers';
import { ToleranceInput } from './ToleranceInput';

const ADVANCED: readonly SettingKey[] = [
  'tolerance',
  'wholeMachines',
  'minerFluids',
  'minerFluidSupply',
];

interface Props {
  store: WorldStore;
  scope: Scope;
  catalog: Catalog;
  /** Simple mode (A72) has no world, so no inherit/override labels (B7). */
  simple?: boolean;
}

/**
 * Solve settings in a scope: the world defaults, or this factory's overrides.
 * In the factory scope each setting shows whether it is inherited, and an
 * override can be reset to the world default. Simple mode shows neither.
 */
export function SettingsPanel({ store, scope, catalog, simple = false }: Props) {
  const world = useStore(store, (s) => s.world);
  const setSetting = useStore(store, (s) => s.setSetting);
  const setFactoryAreas = useStore(store, (s) => s.setFactoryAreas);
  const factory =
    scope.kind === 'factory' ? world.factories.find((f) => f.id === scope.id) : undefined;
  const { values, overridden } =
    scope.kind === 'factory'
      ? effectiveSettings(world, scope.id)
      : { values: world.defaults as Settings, overridden: undefined };
  const minerFluids = values.minerFluids ?? 'any';
  const set = <K extends SettingKey>(key: K, v: Settings[K]) => setSetting(scope, key, v);

  // The Advanced subpanel starts closed; a dot on its header marks a value
  // changed from the app's defaults, so nothing in it changes unseen (UX-5).
  const base = defaultWorldDefaults();
  const changed =
    values.tolerance !== base.tolerance ||
    values.wholeMachines !== base.wholeMachines ||
    minerFluids !== base.minerFluids ||
    (values.minerFluidSupply ?? 'local') !== base.minerFluidSupply ||
    factory?.areas?.off === true ||
    ADVANCED.some((k) => overridden?.[k] === true);
  const [advancedOpen, setAdvancedOpen] = useOpenPref('advanced');

  const meta = (k: SettingKey) => ({
    k,
    overridden: simple ? undefined : overridden?.[k],
    onReset: () => setSetting(scope, k, undefined),
  });

  return (
    <fieldset className="settings">
      <legend>Objectives and options</legend>
      <SettingField {...meta('objectives')}>
        <ObjectiveStack stack={values.objectives} onChange={(o) => set('objectives', o)} />
      </SettingField>
      <SettingField {...meta('alternates')}>
        <label className="check">
          <input
            type="checkbox"
            checked={values.alternates}
            onChange={(e) => set('alternates', e.target.checked)}
          />
          All alternate recipes
        </label>
      </SettingField>
      <SettingField {...meta('maxTier')}>
        <label>
          Max tier
          <select
            value={values.maxTier ?? ''}
            onChange={(e) => set('maxTier', e.target.value === '' ? null : e.target.value)}
          >
            <option value="">No limit</option>
            {tierOptions(catalog.tiers, values.maxTier).map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      </SettingField>
      <SettingField {...meta('costImports')}>
        <label className="check">
          <input
            type="checkbox"
            checked={values.costImports}
            onChange={(e) => set('costImports', e.target.checked)}
          />
          Cost imported inputs
        </label>
      </SettingField>
      <SettingField {...meta('avoidFluidByproducts')}>
        <label className="check">
          <input
            type="checkbox"
            checked={values.avoidFluidByproducts}
            onChange={(e) => set('avoidFluidByproducts', e.target.checked)}
          />
          Avoid fluid byproducts
        </label>
        <p className="hint">
          No leftover fluids except Steam, Flue Gas and Energetic Dark Matter, which can be dumped.
        </p>
      </SettingField>
      <SettingField {...meta('simplicity')}>
        <label className="check">
          <input
            type="checkbox"
            checked={values.simplicity}
            onChange={(e) => set('simplicity', e.target.checked)}
          />
          Prefer simpler plans
        </label>
        <p className="hint">
          Drops slivers and recipe steps that save 1% or less on every objective.
        </p>
      </SettingField>
      <details
        className="advanced"
        open={advancedOpen}
        onToggle={(e) => setAdvancedOpen(e.currentTarget.open)}
      >
        <summary>
          Advanced
          {changed && (
            <span
              className="changed-dot"
              title="A setting in here is changed"
              aria-label="changed"
            />
          )}
        </summary>
        <SettingField {...meta('tolerance')}>
          <ToleranceInput value={values.tolerance} onChange={(t) => set('tolerance', t)} />
        </SettingField>
        <SettingField {...meta('wholeMachines')}>
          <label className="check">
            <input
              type="checkbox"
              checked={values.wholeMachines}
              onChange={(e) => set('wholeMachines', e.target.checked)}
            />
            Whole machines
          </label>
        </SettingField>
        <SettingField {...meta('minerFluids')}>
          <label className="check">
            <input
              type="checkbox"
              checked={minerFluids !== 'none'}
              onChange={(e) => set('minerFluids', e.target.checked ? 'any' : 'none')}
            />
            Model miner optional fluid usage
          </label>
          {minerFluids !== 'none' && (
            <label className="check">
              <input
                type="checkbox"
                checked={minerFluids === 'water'}
                onChange={(e) => set('minerFluids', e.target.checked ? 'water' : 'any')}
              />
              Water only
            </label>
          )}
          <p className="hint">
            Off, miners use no fluid modules, except where an ore can't be mined without one.
          </p>
        </SettingField>
        <SettingField {...meta('minerFluidSupply')}>
          <label>
            Miner fluid{' '}
            <select
              value={values.minerFluidSupply ?? 'local'}
              onChange={(e) => set('minerFluidSupply', e.target.value as MinerFluidSupply)}
            >
              <option value="outside">Supplied from outside</option>
              <option value="local">Made here</option>
            </select>
          </label>
          <p className="hint">
            Supplied from outside, it is imported and still counts as a cost in the objectives.
          </p>
        </SettingField>
        {factory && (
          <div className="setting" data-setting="areas">
            <label className="check">
              <input
                type="checkbox"
                checked={factory.areas?.off === true}
                onChange={(e) => setFactoryAreas(factory.id, { off: e.target.checked })}
              />
              Disable factory component grouping
            </label>
            <p className="hint">
              Draws a large plan as one flowchart instead of areas such as Ore Processing and
              Steelworks.
            </p>
          </div>
        )}
      </details>
    </fieldset>
  );
}

/** One setting; in a factory scope, with its inherit/override state. */
function SettingField(props: {
  k: SettingKey;
  /** `undefined` in the world scope. */
  overridden: boolean | undefined;
  onReset(): void;
  children: ReactNode;
}) {
  const { k, overridden, onReset, children } = props;
  return (
    <div className="setting" data-setting={k}>
      {overridden === true && (
        <button
          type="button"
          className="setting-reset"
          onClick={onReset}
          aria-label={`Use the world default for ${k}`}
          title="Overridden here. Reset to the world default."
        >
          ↺
        </button>
      )}
      {overridden === false && (
        <span className="badge setting-badge" title="Inherited from the world defaults">
          world default
        </span>
      )}
      {children}
    </div>
  );
}
