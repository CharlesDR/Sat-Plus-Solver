import type { World } from '@sps/world';
import { useMemo } from 'react';
import { countLabel, type DiagnosticView, type Fix, type Names } from './diagnostics';
import type { Catalog } from './solver/protocol';

/** Display names from the catalog and the world, falling back to ids. */
export function useNames(catalog: Catalog, world: World): Names {
  return useMemo(
    () => ({
      item: lookup(catalog.items, (r) => r.name),
      recipe: lookup(catalog.recipes, (r) => r.name),
      node: lookup(catalog.nodes, (r) => r.label),
      factory: lookup(world.factories, (r) => r.name),
    }),
    [catalog, world.factories],
  );
}

function lookup<T extends { id: string }>(rows: readonly T[], label: (r: T) => string) {
  const m = new Map(rows.map((r) => [r.id, label(r)]));
  return (id: string) => m.get(id) ?? id;
}

/** Diagnostics with their one-click fixes (§3.5, M10). Renders nothing when there are none. */
export function DiagnosticsList(props: {
  label: string;
  views: DiagnosticView[];
  onFix(fix: Fix): void;
}) {
  const { label, views, onFix } = props;
  if (!views.length) return null;
  return (
    <section className="diagnostics" aria-label={label}>
      <h2>
        {label}: {countLabel(views)}
      </h2>
      <ul>
        {views.map((v, k) => (
          <li key={k} className={v.severity}>
            <strong>
              {v.severity === 'error' ? 'Error' : 'Warning'}: {v.title}
            </strong>
            <p>{v.message}</p>
            {v.fixes.length > 0 && (
              <div className="fixes">
                {v.fixes.map((f, j) => (
                  <button key={j} type="button" onClick={() => onFix(f)}>
                    {f.label}
                  </button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
