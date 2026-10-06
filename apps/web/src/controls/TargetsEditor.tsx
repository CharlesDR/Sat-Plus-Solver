import type { ItemRate } from '@sps/solver';
import { useId, useState } from 'react';
import { CloseIcon, PlusIcon } from '../ui/icons';
import type { CatalogItem } from '../solver/protocol';
import { newRowKey, positive, useItemLookup, type DraftRow } from './itemRows';

interface Props {
  catalog: CatalogItem[];
  targets: readonly ItemRate[];
  onChange(targets: ItemRate[]): void;
}

/**
 * The factory's targets: one row per item and rate. Rows that don't name a
 * known item with a positive rate stay in the editor but out of the plan.
 */
export function TargetsEditor({ catalog, targets, onChange }: Props) {
  const listId = useId();
  const items = useItemLookup(catalog);
  const [rows, setRows] = useState<DraftRow[]>(() =>
    (targets.length ? targets : [undefined]).map((t) => ({
      key: newRowKey(),
      itemText: t ? items.name(t.item) : '',
      numberText: String(t?.rate ?? 60),
    })),
  );

  const validOf = (next: DraftRow[]) => {
    const valid: ItemRate[] = [];
    for (const r of next) {
      const item = items.find(r.itemText);
      const rate = positive(r.numberText);
      if (item && rate !== undefined) valid.push({ item: item.id, rate });
    }
    return valid;
  };
  const sameAs = (valid: ItemRate[]) =>
    valid.length === targets.length &&
    valid.every((t, k) => t.item === targets[k]!.item && t.rate === targets[k]!.rate);
  const update = (next: DraftRow[]) => {
    setRows(next);
    const valid = validOf(next);
    if (!sameAs(valid)) onChange(valid);
  };
  const addRow = () => update([...rows, { key: newRowKey(), itemText: '', numberText: '60' }]);

  // Targets changed elsewhere (quick search, a loaded world): show them. This
  // adjusts state while rendering, React's pattern for following a prop.
  const [shown, setShown] = useState(targets);
  if (shown !== targets) {
    setShown(targets);
    if (!sameAs(validOf(rows)))
      setRows(
        (targets.length ? targets : [undefined]).map((t) => ({
          key: newRowKey(),
          itemText: t ? items.name(t.item) : '',
          numberText: String(t?.rate ?? 60),
        })),
      );
  }
  const edit = (key: number, patch: Partial<DraftRow>) =>
    update(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <fieldset className="targets">
      <legend>Targets</legend>
      <datalist id={listId}>
        {catalog.map((c) => (
          <option key={c.id} value={c.name} />
        ))}
      </datalist>
      {rows.map((r, k) => {
        const n = k === 0 ? '' : ` ${k + 1}`;
        const unknown = r.itemText.trim() !== '' && !items.find(r.itemText);
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
              />
            </label>
            <label>
              Per minute{n}
              <input
                type="number"
                min="0"
                step="any"
                value={r.numberText}
                aria-invalid={positive(r.numberText) === undefined}
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
                title="Remove this target"
                onClick={() => update(rows.filter((x) => x.key !== r.key))}
              >
                <CloseIcon />
              </button>
            )}
            {unknown && <p className="hint">No item named “{r.itemText}”.</p>}
          </div>
        );
      })}
      <button type="button" className="ghost" onClick={addRow}>
        <PlusIcon /> Add target
      </button>
    </fieldset>
  );
}
