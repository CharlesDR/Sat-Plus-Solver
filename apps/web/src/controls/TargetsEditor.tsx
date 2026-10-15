import type { Target } from '@sps/world';
import { useId, useMemo, useRef, useState } from 'react';
import { readRecentTargets, withRecent, writeRecentTargets } from '../ui/prefs';
import { CloseIcon, PlusIcon } from '../ui/icons';
import type { CatalogItem } from '../solver/protocol';
import { newRowKey, useItemLookup, type DraftRow } from './itemRows';
import { itemsUpToTier } from './tiers';

interface Props {
  catalog: CatalogItem[];
  targets: readonly Target[];
  /** The effective max tier: the picker offers only items made at or below it (UX-17). */
  maxTier?: string | null | undefined;
  onChange(targets: Target[]): void;
}

/** A target row's draft: the For links rate in `numberText`, and Kept (A92). */
type TargetRow = DraftRow & { keptText: string };

/** A rate box's value: blank is 0; `undefined` when it isn't a number ≥ 0. */
function rateOf(text: string): number | undefined {
  if (text.trim() === '') return 0;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

const rowOf = (t: Target | undefined, name: (id: string) => string): TargetRow => ({
  key: newRowKey(),
  itemText: t ? name(t.item) : '',
  numberText: String(t?.rate ?? 60),
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
  const box = useRef<HTMLFieldSetElement>(null);
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
        : [...rows, { key: newRowKey(), itemText: name, numberText: '60', keptText: '' }],
    );
  };
  const chips = recent.filter((id) => items.find(id) && !targets.some((t) => t.item === id));
  const addRow = () =>
    update([...rows, { key: newRowKey(), itemText: '', numberText: '60', keptText: '' }]);

  // Targets changed elsewhere (quick search, a loaded world): show them. This
  // adjusts state while rendering, React's pattern for following a prop.
  const [shown, setShown] = useState(targets);
  if (shown !== targets) {
    setShown(targets);
    if (!sameAs(validOf(rows)))
      setRows((targets.length ? targets : [undefined]).map((t) => rowOf(t, items.name)));
  }
  const edit = (key: number, patch: Partial<TargetRow>) =>
    update(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <fieldset className="targets" ref={box}>
      <legend>Targets</legend>
      <datalist id={listId}>
        {offered.map((c) => (
          <option key={c.id} value={c.name} />
        ))}
      </datalist>
      {rows.map((r, k) => {
        const n = k === 0 ? '' : ` ${k + 1}`;
        const unknown = r.itemText.trim() !== '' && !items.find(r.itemText);
        // A Space Elevator phase is planned in its top part's rate (A84).
        const per = items.find(r.itemText)?.per;
        return (
          <div className="row" key={r.key}>
            <label>
              Target item{n}
              <input
                list={listId}
                value={r.itemText}
                placeholder="Search items…"
                aria-invalid={unknown}
                onChange={(e) => edit(r.key, { itemText: e.target.value })}
                // Enter on a known item goes on to its rate (UX-12).
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' || !items.find(r.itemText)) return;
                  e.preventDefault();
                  const rates =
                    box.current?.querySelectorAll<HTMLInputElement>('input[type=number]');
                  rates?.[k]?.select();
                }}
              />
            </label>
            <label data-help="target-for-links">
              <span className="sub-label">For links</span> per minute{n}
              <input
                type="number"
                min="0"
                step="any"
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
            <label className="kept" data-help="target-kept">
              Kept{n}
              <input
                type="number"
                min="0"
                step="any"
                placeholder="0"
                value={r.keptText}
                aria-invalid={rateOf(r.keptText) === undefined}
                onChange={(e) => edit(r.key, { keptText: e.target.value })}
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
            {unknown && <p className="hint">No item named “{r.itemText}”.</p>}
            {per && <p className="hint">Rate is per min of {per}, the phase’s top part.</p>}
          </div>
        );
      })}
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
              title={`Add ${items.name(id)} at 60/min`}
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
