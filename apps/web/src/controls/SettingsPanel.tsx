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
import { ObjectiveStack } from './ObjectiveStack';
import { ToleranceInput } from './ToleranceInput';

interface Props {
  store: WorldStore;
  scope: Scope;
  catalog: Catalog;
}

/**
 * Solve settings in a scope: the world defaults, or this factory's overrides.
 * In the factory scope each setting shows whether it is inherited, and an
 * override can be reset to the world default.
 */
export function SettingsPanel({ store, scope, catalog }: Props) {
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

  const meta = (k: SettingKey) => ({
    k,
    overridden: overridden?.[k],
    onReset: () => setSetting(scope, k, undefined),
  });

  return (
    <fieldset className="settings">
      <legend>Objectives and options</legend>
      <SettingField {...meta('objectives')}>
        <ObjectiveStack stack={values.objectives} onChange={(o) => set('objectives', o)} />
      </SettingField>
      <SettingField {...meta('tolerance')}>
        <ToleranceInput value={values.tolerance} onChange={(t) => set('tolerance', t)} />
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
      <SettingField {...meta('maxTier')}>
        <label>
          Max tier
          <select
            value={values.maxTier ?? ''}
            onChange={(e) => set('maxTier', e.target.value === '' ? null : e.target.value)}
          >
            <option value="">No limit</option>
            {catalog.tiers.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </SettingField>
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
      {children}
      {overridden === true && (
        <button
          type="button"
          className="link"
          onClick={onReset}
          aria-label={`Use the world default for ${k}`}
        >
          Use world default
        </button>
      )}
      {overridden === false && <span className="hint">world default</span>}
    </div>
  );
}
