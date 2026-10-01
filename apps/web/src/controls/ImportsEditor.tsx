import type { UnassignedImport } from '@sps/world';
import { useId, useState } from 'react';
import type { CatalogItem } from '../solver/protocol';
import { newRowKey, positive, useItemLookup, type DraftRow } from './itemRows';

interface Props {
  catalog: CatalogItem[];
  imports: readonly UnassignedImport[];
  onChange(imports: UnassignedImport[]): void;
}

const same = (a: readonly UnassignedImport[], b: readonly UnassignedImport[]) =>
  a.length === b.length && a.every((x, k) => x.item === b[k]!.item && x.cap === b[k]!.cap);

/**
 * Unassigned imports: items this factory gets from outside the save's links,
 * each with an optional cap per minute (blank = unlimited).
 */
export function ImportsEditor({ catalog, imports, onChange }: Props) {
  const listId = useId();
  const items = useItemLookup(catalog);
  const [rows, setRows] = useState<DraftRow[]>(() =>
    imports.map((i) => ({
      key: newRowKey(),
      itemText: items.name(i.item),
      numberText: i.cap === undefined ? '' : String(i.cap),
    })),
  );

  const update = (next: DraftRow[]) => {
    setRows(next);
    const valid: UnassignedImport[] = [];
    for (const r of next) {
      const item = items.find(r.itemText);
      if (!item) continue;
      if (r.numberText.trim() === '') valid.push({ item: item.id });
      else {
        const cap = positive(r.numberText);
        if (cap !== undefined) valid.push({ item: item.id, cap });
      }
    }
    if (!same(valid, imports)) onChange(valid);
  };
  const edit = (key: number, patch: Partial<DraftRow>) =>
    update(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <fieldset className="imports" aria-label="Unassigned imports">
      <p className="hint">
        Items brought in from outside the save’s links. Free unless “Cost imported inputs” is on.
      </p>
      <datalist id={listId}>
        {catalog.map((c) => (
          <option key={c.id} value={c.name} />
        ))}
      </datalist>
      {rows.map((r, k) => {
        const unknown = r.itemText.trim() !== '' && !items.find(r.itemText);
        const badCap = r.numberText.trim() !== '' && positive(r.numberText) === undefined;
        return (
          <div className="row" key={r.key}>
            <label>
              Import item {k + 1}
              <input
                list={listId}
                value={r.itemText}
                placeholder="Search items…"
                aria-invalid={unknown}
                onChange={(e) => edit(r.key, { itemText: e.target.value })}
              />
            </label>
            <label>
              Cap per minute {k + 1}
              <input
                type="number"
                min="0"
                step="any"
                value={r.numberText}
                placeholder="Unlimited"
                aria-invalid={badCap}
                onChange={(e) => edit(r.key, { numberText: e.target.value })}
              />
            </label>
            <button
              type="button"
              aria-label={`Remove import ${k + 1}`}
              onClick={() => update(rows.filter((x) => x.key !== r.key))}
            >
              Remove
            </button>
            {unknown && <p className="hint">No item named “{r.itemText}”.</p>}
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => update([...rows, { key: newRowKey(), itemText: '', numberText: '' }])}
      >
        Add import
      </button>
    </fieldset>
  );
}
