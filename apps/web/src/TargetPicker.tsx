import type { ItemRate } from '@sps/solver';
import { useId, useMemo, useState } from 'react';
import type { CatalogItem } from './solver/protocol';

interface Props {
  catalog: CatalogItem[];
  target: ItemRate | undefined;
  onChange(target: ItemRate | null): void;
}

/** One target: an item (typed or picked from the list) and a rate per minute. */
export function TargetPicker({ catalog, target, onChange }: Props) {
  const listId = useId();
  const byKey = useMemo(() => {
    const m = new Map<string, CatalogItem>();
    for (const c of catalog) {
      m.set(c.name.toLowerCase(), c);
      m.set(c.id, c);
    }
    return m;
  }, [catalog]);
  const [itemText, setItemText] = useState(
    () => catalog.find((c) => c.id === target?.item)?.name ?? '',
  );
  const [rateText, setRateText] = useState(() => String(target?.rate ?? 60));

  const item = byKey.get(itemText.trim().toLowerCase());
  const rate = Number(rateText);
  const rateOk = rateText.trim() !== '' && Number.isFinite(rate) && rate > 0;

  const commit = (nextItem: CatalogItem | undefined, nextRateOk: boolean, nextRate: number) => {
    if (!nextItem || !nextRateOk) return;
    if (target?.item === nextItem.id && target.rate === nextRate) return;
    onChange({ item: nextItem.id, rate: nextRate });
  };

  return (
    <form className="target-picker" onSubmit={(e) => e.preventDefault()}>
      <label>
        Target item
        <input
          list={listId}
          value={itemText}
          placeholder="Search items…"
          aria-invalid={itemText.trim() !== '' && !item}
          onChange={(e) => {
            const text = e.target.value;
            setItemText(text);
            if (text.trim() === '') return onChange(null);
            commit(byKey.get(text.trim().toLowerCase()), rateOk, rate);
          }}
        />
        <datalist id={listId}>
          {catalog.map((c) => (
            <option key={c.id} value={c.name} />
          ))}
        </datalist>
      </label>
      <label>
        Per minute
        <input
          type="number"
          min="0"
          step="any"
          value={rateText}
          aria-invalid={!rateOk}
          onChange={(e) => {
            const text = e.target.value;
            const n = Number(text);
            setRateText(text);
            commit(item, text.trim() !== '' && Number.isFinite(n) && n > 0, n);
          }}
        />
      </label>
      {itemText.trim() !== '' && !item && <p className="hint">No item named “{itemText}”.</p>}
    </form>
  );
}
