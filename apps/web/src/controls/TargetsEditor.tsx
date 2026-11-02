import type { Target } from '@sps/world';
import { useId, useMemo, useState } from 'react';
import { readRecentTargets, withRecent, writeRecentTargets } from '../ui/prefs';
import { CloseIcon, PlusIcon } from '../ui/icons';
import type { CatalogItem } from '../solver/protocol';
import { newRowKey, useItemLookup, type DraftRow } from './itemRows';
import { itemsAboveTier, itemsUpToTier, tierLabel } from './tiers';

interface Props {
  catalog: CatalogItem[];
  targets: readonly Target[];
  /** The effective max tier: the picker offers only items made at or below it (UX-17). */
  maxTier?: string | null | undefined;
  onChange(targets: Target[]): void;
}

/** Hidden items a hint names before "and n more". */
const MAX_NAMED = 4;

/**
 * A target row's draft: Kept, and the For links rate in `numberText` (A92).
 * Both start blank, so a new target asks for its rate instead of assuming one.
 */
type TargetRow = DraftRow & { keptText: string };

/** A rate box's value: blank is 0; `undefined` when it isn't a number ≥ 0. */
function rateOf(text: string): number | undefined {
  if (text.trim() === '') return 0;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

const blankRow = (itemText = ''): TargetRow => ({
  key: newRowKey(),
  itemText,
  numberText: '',
  keptText: '',
});

const rowOf = (t: Target | undefined, name: (id: string) => string): TargetRow => ({
  key: newRowKey(),
  itemText: t ? name(t.item) : '',
  numberText: t?.rate ? String(t.rate) : '',
  keptText: t?.kept ? String(t.kept) : '',
});

/**
 * The factory's targets: one row per item, with its For links and Kept
 * rates (A92). Rows that don't name a known item with a rate above 0 stay in
 * the editor but out of the plan.
 */
export function TargetsEditor({ catalog, targets, maxTier, onChange }: Props) {
  const listId = useId();
  const items = useItemLookup(catalog);
  const offered = useMemo(() => itemsUpToTier(catalog, maxTier), [catalog, maxTier]);
  // What the max tier leaves out of the list, so a missing item is explained (R2).
  const hidden = useMemo(() => itemsAboveTier(catalog, maxTier), [catalog, maxTier]);
  /** Hidden items a row's text names or matches, when no listed item matches it. */
  const hiddenMatches = (text: string): readonly CatalogItem[] => {
    const q = text.trim().toLowerCase();
    if (!q || !hidden.length) return [];
    const exact = hidden.filter((i) => i.name.toLowerCase() === q);
    if (exact.length) return exact;
    if (offered.some((i) => i.name.toLowerCase().includes(q))) return [];
    return hidden.filter((i) => i.name.toLowerCase().includes(q));
  };
  // Recently planned items as quick chips (UX-12), kept per browser.
  const [recent, setRecent] = useState(readRecentTargets);
  const [rows, setRows] = useState<TargetRow[]>(() =>
    (targets.length ? targets : [undefined]).map((t) => rowOf(t, items.name)),
  );

  const validOf = (next: TargetRow[]) => {
    const valid: Target[] = [];
    for (const r of next) {
      const item = items.find(r.itemText);
      const rate = rateOf(r.numberText);
      const kept = rateOf(r.keptText);
      if (item && rate !== undefined && kept !== undefined && rate + kept > 0)
        valid.push({ item: item.id, rate, ...(kept > 0 ? { kept } : {}) });
    }
    return valid;
  };
  const sameAs = (valid: Target[]) =>
    valid.length === targets.length &&
    valid.every(
      (t, k) =>
        t.item === targets[k]!.item &&
        t.rate === targets[k]!.rate &&
        (t.kept ?? 0) === (targets[k]!.kept ?? 0),
    );
  const update = (next: TargetRow[]) => {
    setRows(next);
    const valid = validOf(next);
    if (!sameAs(valid)) {
      onChange(valid);
      const added = valid.map((t) => t.item).filter((i) => !targets.some((t) => t.item === i));
      if (added.length) {
        const r = withRecent(recent, added);
        setRecent(r);
        writeRecentTargets(r);
      }
    }
  };
  // A chip fills the last row when it names no item yet, else adds a row.
  const addItem = (id: string) => {
    const last = rows[rows.length - 1];
    const name = items.name(id);
    update(
      last && last.itemText.trim() === ''
        ? rows.map((r) => (r === last ? { ...r, itemText: name } : r))
        : [...rows, blankRow(name)],
    );
  };
  // A chip's item already in a row, rate typed or not, isn't offered again.
  const chips = recent.filter(
    (id) => items.find(id) && !rows.some((r) => items.find(r.itemText)?.id === id),
  );
  const addRow = () => update([...rows, blankRow()]);

  // Targets changed elsewhere (quick search, a loaded world): show them. This
  // adjusts state while rendering, React's pattern for following a prop.
  const [shown, setShown] = useState(targets);
  if (shown !== targets) {
    setShown(targets);
    if (!sameAs(validOf(rows)))
      setRows((targets.length ? targets : [undefined]).map((t) => rowOf(t, items.name)));
  }
  /** Selects the rate box after `from` in its row (Kept, then For links). */
  const nextRate = (from: HTMLInputElement) => {
    const rates = from.closest('.row')?.querySelectorAll<HTMLInputElement>('input[type=number]');
    const all = rates ? [...rates] : [];
    all[all.indexOf(from) + 1]?.select();
  };
  const edit = (key: number, patch: Partial<TargetRow>) =>
    update(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <fieldset className="targets">
      <legend>Targets</legend>
      <datalist id={listId}>
        {offered.map((c) => (
          <option key={c.id} value={c.name} />
        ))}
      </datalist>
      {rows.map((r, k) => {
        const n = k === 0 ? '' : ` ${k + 1}`;
        const unknown = r.itemText.trim() !== '' && !items.find(r.itemText);
        const above = hiddenMatches(r.itemText);
        // A Space Elevator phase is planned in its top part's rate (A84).
        const per = items.find(r.itemText)?.per;
        // The first row's labels head the columns; later rows keep theirs for screen readers (DF-9).
        const text = k === 0 ? undefined : 'visually-hidden';
        return (
          <div className="row" key={r.key}>
            <label>
              <span className={text}>Target item{n}</span>
              <input
                list={listId}
                value={r.itemText}
                placeholder="Search items…"
                aria-invalid={unknown}
                onChange={(e) => edit(r.key, { itemText: e.target.value })}
                // Enter on a known item goes on to its first rate (UX-12).
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' || !items.find(r.itemText)) return;
                  e.preventDefault();
                  nextRate(e.currentTarget);
                }}
              />
            </label>
            <label className="kept" data-help="target-kept">
              <span className={text}>Kept{n}</span>
              <input
                type="number"
                min="0"
                step="any"
                placeholder="0"
                value={r.keptText}
                aria-invalid={rateOf(r.keptText) === undefined}
                onChange={(e) => edit(r.key, { keptText: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  nextRate(e.currentTarget);
                }}
              />
            </label>
            <label data-help="target-for-links">
              <span className={text}>
                <span className="sub-label">For links</span> per minute{n}
              </span>
              <input
                type="number"
                min="0"
                step="any"
                placeholder="0"
                value={r.numberText}
                aria-invalid={rateOf(r.numberText) === undefined}
                onChange={(e) => edit(r.key, { numberText: e.target.value })}
                // Enter in the last rate adds the next target.
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && k === rows.length - 1) {
                    e.preventDefault();
                    addRow();
                  }
                }}
              />
            </label>
            {rows.length > 1 && (
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove target${n || ' 1'}`}
                data-help="target-remove"
                onClick={() => update(rows.filter((x) => x.key !== r.key))}
              >
                <CloseIcon />
              </button>
            )}
            {above.length > 0 ? (
              <p className="hint" data-testid="above-tier">
                Needs a higher Max tier than {tierLabel(maxTier!)}:{' '}
                {above
                  .slice(0, MAX_NAMED)
                  .map((i) => `${i.name} (${tierLabel(i.tier!)})`)
                  .join(', ')}
                {above.length > MAX_NAMED ? `, and ${above.length - MAX_NAMED} more` : ''}.
              </p>
            ) : (
              unknown && <p className="hint">No item named “{r.itemText}”.</p>
            )}
            {per && <p className="hint">Rate is per min of {per}, the phase’s top part.</p>}
          </div>
        );
      })}
      {hidden.length > 0 && (
        <p className="hint" data-testid="hidden-by-tier">
          {hidden.length} {hidden.length === 1 ? 'item needs' : 'items need'} a higher Max tier than{' '}
          {tierLabel(maxTier!)} and {hidden.length === 1 ? 'isn’t' : 'aren’t'} listed.
        </p>
      )}
      <button type="button" className="ghost" onClick={addRow}>
        <PlusIcon /> Add target
      </button>
      {chips.length > 0 && (
        <div className="recent-targets" role="group" aria-label="Recent targets">
          {chips.map((id) => (
            <button
              key={id}
              type="button"
              className="chip"
              title={`Add ${items.name(id)}`}
              onClick={() => addItem(id)}
            >
              <PlusIcon /> {items.name(id)}
            </button>
          ))}
        </div>
      )}
    </fieldset>
  );
}
