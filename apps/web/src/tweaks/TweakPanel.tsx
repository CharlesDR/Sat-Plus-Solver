/**
 * Plan tweaks (A35): the tweak list with Undo and Revert all, and the actions
 * for the recipe group selected in the flowchart or the plan table: don't use
 * it, swap it for another recipe (with each swap's effect previewed), or
 * import its product instead.
 */
import type { FlowNode } from '@sps/graph';
import type { Factory, Tweak, World } from '@sps/world';
import { useEffect, useMemo, useState } from 'react';
import type { SolveOutcome } from '../solver/client';
import type { CatalogRecipe, SwapPreview, WorldAction } from '../solver/protocol';
import {
  previewDelta,
  swapCandidates,
  tweakLabel,
  tweakTarget,
  type Baseline,
  type Names,
} from './tweaks';

type Previews =
  | { kind: 'done'; byRecipe: Map<string, SwapPreview> }
  /** An edit replaced the comparison before it ran. */
  | { kind: 'interrupted' }
  | { kind: 'error'; message: string };

export function TweakPanel(props: {
  world: World;
  factory: Factory;
  recipes: readonly CatalogRecipe[];
  names: Names;
  /** The selected flowchart node, if any. */
  node: FlowNode | undefined;
  /** The factory's current numbers; previews wait for them. */
  baseline: Baseline | undefined;
  run(action: WorldAction): Promise<SolveOutcome | null>;
  onTweak(tweak: Tweak): void;
  onUndo(): void;
  onRemove(index: number): void;
  onRevert(): void;
}) {
  const { world, factory, recipes, names, node, baseline, run } = props;
  const byId = useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes]);
  const target = tweakTarget(node, byId);
  const [swapFor, setSwapFor] = useState<string>();
  const swapping = target !== undefined && swapFor === target.recipe;
  const candidates = useMemo(
    () => (swapping ? swapCandidates(world, factory, target, recipes) : []),
    [swapping, world, factory, target?.recipe, target?.product, recipes], // eslint-disable-line react-hooks/exhaustive-deps -- `target` is rebuilt each render; its fields are the deps.
  );
  const open = candidates.filter((c) => !c.blocked).map((c) => c.recipe.id);
  // What a comparison is for: a result for an older world or list is never shown.
  const key = swapping && open.length ? `${factory.id}\n${target.recipe}\n${open.join('\n')}` : '';
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<{ world: World; key: string; previews: Previews }>();
  const previews = settled?.world === world && settled.key === key ? settled.previews : undefined;

  useEffect(() => {
    if (!key) return;
    let live = true;
    const [factoryId, from, ...list] = key.split('\n') as [string, string, ...string[]];
    const done = (p: Previews) => live && setSettled({ world, key, previews: p });
    run({ kind: 'preview-swaps', factoryId, from, candidates: list }).then(
      (o) =>
        done(
          o?.previews
            ? { kind: 'done', byRecipe: new Map(o.previews.map((p) => [p.recipe, p])) }
            : { kind: 'interrupted' },
        ),
      (e: unknown) => done({ kind: 'error', message: (e as Error).message }),
    );
    return () => {
      live = false;
    };
  }, [key, world, attempt, run]);

  const tweaks = factory.tweaks;
  return (
    <section className="tweaks" aria-label="Plan tweaks">
      <div className="tweak-bar">
        <strong>Manual tweaks ({tweaks.length})</strong>
        <button
          type="button"
          onClick={props.onUndo}
          disabled={!tweaks.length}
          title="Undo the last tweak (Ctrl+Z)"
        >
          Undo
        </button>
        <button type="button" onClick={props.onRevert} disabled={!tweaks.length}>
          Revert all
        </button>
        {tweaks.length ? (
          <ol className="tweak-list" aria-label="Tweaks, oldest first">
            {tweaks.map((t, k) => (
              <li key={k} className="chip">
                {tweakLabel(t, names)}
                <button
                  type="button"
                  className="link"
                  aria-label={`Remove tweak: ${tweakLabel(t, names)}`}
                  onClick={() => props.onRemove(k)}
                >
                  ×
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <span className="hint">
            Select a recipe in the flowchart or the table to change it. Revert all returns to the
            solver’s plan.
          </span>
        )}
      </div>
      {target && (
        <div className="node-actions" role="group" aria-label={`Change ${target.name}`}>
          <span className="node-name">{target.name}</span>
          <button
            type="button"
            onClick={() => props.onTweak({ kind: 'ban', recipe: target.recipe })}
          >
            Don’t use this recipe
          </button>
          <button
            type="button"
            aria-expanded={swapping}
            onClick={() => setSwapFor(swapping ? undefined : target.recipe)}
          >
            Swap recipe…
          </button>
          <button
            type="button"
            onClick={() => props.onTweak({ kind: 'import', item: target.product })}
          >
            Import {names.item(target.product)} instead
          </button>
          {swapping && (
            <SwapList
              names={names}
              candidates={candidates}
              previews={previews}
              baseline={baseline}
              onRetry={() => setAttempt((n) => n + 1)}
              onPick={(to) => {
                setSwapFor(undefined);
                props.onTweak({ kind: 'swap', from: target.recipe, to });
              }}
            />
          )}
        </div>
      )}
    </section>
  );
}

function SwapList(props: {
  names: Names;
  candidates: ReturnType<typeof swapCandidates>;
  previews: Previews | undefined;
  baseline: Baseline | undefined;
  onPick(recipe: string): void;
  onRetry(): void;
}) {
  const { names, candidates, previews, baseline } = props;
  if (!candidates.length)
    return <p className="hint swap-list">No other recipe makes this product.</p>;
  const effect = (id: string) => {
    if (previews?.kind === 'error') return `Couldn’t compare: ${previews.message}`;
    if (previews?.kind === 'interrupted') return '';
    const p = previews?.kind === 'done' ? previews.byRecipe.get(id) : undefined;
    return p && baseline ? previewDelta(baseline, p, names) : 'Comparing…';
  };
  return (
    <ul className="swap-list" aria-label="Recipes to swap in">
      {previews?.kind === 'interrupted' && (
        <li>
          <span className="hint">The comparison was interrupted.</span>
          <button type="button" className="link" onClick={props.onRetry}>
            Compare again
          </button>
        </li>
      )}
      {candidates.map(({ recipe, blocked }) => (
        <li key={recipe.id}>
          <button type="button" disabled={!!blocked} onClick={() => props.onPick(recipe.id)}>
            Use {recipe.name}
          </button>
          <span className="meta">
            {recipe.machine}
            {recipe.alternate && <span className="badge">alternate</span>}
          </span>
          <span className="effect" aria-live="polite">
            {blocked ? 'Above the max tier' : effect(recipe.id)}
          </span>
        </li>
      ))}
    </ul>
  );
}
