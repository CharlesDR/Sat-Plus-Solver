/**
 * The link editor (PLAN M8): from and to factories, the item, `fixed` or
 * `pull`, and the transport with its belt or pipe count. Opened by dragging
 * between two factories on the canvas, by "Add link", or by "Edit" in the
 * link table.
 */
import type { Link, LinkSpec, Transport, World } from '@sps/world';
import { useId, useState } from 'react';
import { Field } from '../controls/Field';
import { useItemLookup } from '../controls/itemRows';
import type { Catalog, WorldSummary } from '../solver/protocol';
import { carriersFor, exportsOf, transportTiers } from './viewModel';

const TRANSPORTS: { kind: Transport; label: string }[] = [
  { kind: 'unspecified', label: 'Unspecified' },
  { kind: 'belt', label: 'Belt' },
  { kind: 'pipe', label: 'Pipe' },
  { kind: 'train', label: 'Train' },
  { kind: 'truck', label: 'Truck' },
  { kind: 'drone', label: 'Drone' },
];

/** A link being drawn: a new one between two factories, or an existing one. */
export type LinkDraft = { from: string; to: string; link?: Link };

export function LinkEditor(props: {
  world: World;
  summary: WorldSummary | undefined;
  catalog: Catalog;
  draft: LinkDraft;
  onSave(spec: LinkSpec, id: string | undefined): void;
  onCancel(): void;
}) {
  const { world, summary, catalog, draft, onSave, onCancel } = props;
  const listId = useId();
  const items = useItemLookup(catalog.items);
  const fluids = new Set(catalog.fluids);
  const link = draft.link;
  const editing = link?.id;
  const [from, setFrom] = useState(draft.from);
  const [to, setTo] = useState(draft.to);
  const [itemText, setItemText] = useState(link ? items.name(link.item) : '');
  const [mode, setMode] = useState<'pull' | 'fixed'>(link?.mode.kind ?? 'pull');
  const [rateText, setRateText] = useState(
    link?.mode.kind === 'fixed' ? String(link.mode.rate) : '60',
  );
  const [kind, setKind] = useState<Transport>(link?.transport?.kind ?? 'unspecified');
  const [tier, setTier] = useState<number | undefined>(link?.transport?.tier);
  const [error, setError] = useState<string>();

  const item = items.find(itemText);
  const rate = Number(rateText);
  const rateOk = rateText.trim() !== '' && Number.isFinite(rate) && rate >= 0;
  const tiers = transportTiers(catalog, kind);
  const suggested = exportsOf(summary, from);
  const others = catalog.items.filter((c) => !suggested.includes(c.id));
  const shown = summary?.links.find((l) => l.id === editing);
  const previewRate = mode === 'fixed' ? (rateOk ? rate : 0) : shown?.requested;
  const carriers =
    previewRate !== undefined
      ? carriersFor(catalog, tier !== undefined ? { kind, tier } : { kind }, previewRate)
      : undefined;

  const pickKind = (k: Transport) => {
    setKind(k);
    const t = transportTiers(catalog, k);
    setTier(t.length ? t[0]!.tier : undefined);
  };
  const pickItem = (text: string) => {
    setItemText(text);
    const found = items.find(text);
    // A fresh link picks belts or pipes for what it carries.
    if (found && !link && (kind === 'unspecified' || kind === 'belt' || kind === 'pipe'))
      pickKind(fluids.has(found.id) ? 'pipe' : 'belt');
  };

  const save = () => {
    if (!item) return setError(`Pick an item${itemText ? `: no item named “${itemText}”` : ''}.`);
    if (mode === 'fixed' && !rateOk) return setError('A fixed link needs a rate of 0 or more.');
    const spec: LinkSpec = {
      from,
      to,
      item: item.id,
      mode: mode === 'fixed' ? { kind: 'fixed', rate } : { kind: 'pull' },
      ...(kind !== 'unspecified'
        ? { transport: tier !== undefined ? { kind, tier } : { kind } }
        : {}),
    };
    try {
      onSave(spec, editing);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const factorySelect = (label: string, value: string, set: (v: string) => void) => (
    <Field label={label}>
      {(id) => (
        <select id={id} value={value} onChange={(e) => set(e.target.value)}>
          {world.factories.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      )}
    </Field>
  );

  return (
    <form
      className="controls link-editor"
      aria-label={editing ? 'Edit link' : 'New link'}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <fieldset>
        <legend>{editing ? 'Edit link' : 'New link'}</legend>
        <div className="row">
          {factorySelect('From', from, setFrom)}
          {factorySelect('To', to, setTo)}
          <Field label="Item">
            {(id) => (
              <input
                id={id}
                list={listId}
                value={itemText}
                placeholder="Search items…"
                aria-invalid={itemText.trim() !== '' && !item}
                onChange={(e) => pickItem(e.target.value)}
              />
            )}
          </Field>
          <datalist id={listId}>
            {[...suggested.map((id) => items.name(id)), ...others.map((c) => c.name)].map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </div>
        <div className="row" role="radiogroup" aria-label="Link mode">
          <label className="check">
            <input
              type="radio"
              name="link-mode"
              checked={mode === 'pull'}
              onChange={() => setMode('pull')}
            />
            Pull (what the consumer needs)
          </label>
          <label className="check">
            <input
              type="radio"
              name="link-mode"
              checked={mode === 'fixed'}
              onChange={() => setMode('fixed')}
            />
            Fixed rate
          </label>
          {mode === 'fixed' && (
            <label>
              Rate per minute
              <input
                type="number"
                min="0"
                step="any"
                value={rateText}
                aria-invalid={!rateOk}
                onChange={(e) => setRateText(e.target.value)}
              />
            </label>
          )}
        </div>
        <div className="row">
          <Field label="Transport">
            {(id) => (
              <select id={id} value={kind} onChange={(e) => pickKind(e.target.value as Transport)}>
                {TRANSPORTS.map((t) => (
                  <option key={t.kind} value={t.kind}>
                    {t.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {tiers.length > 0 && (
            <Field label="Tier">
              {(id) => (
                <select
                  id={id}
                  value={tier ?? ''}
                  onChange={(e) => setTier(Number(e.target.value))}
                >
                  {tiers.map((t) => (
                    <option key={t.tier} value={t.tier}>
                      Mk.{t.tier} ({t.perMin}/min)
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
          <p className="hint" data-testid="carriers">
            {carriers !== undefined
              ? `Needs ${carriers} ${kind === 'pipe' ? 'pipe' : 'belt'}${carriers === 1 ? '' : 's'}.`
              : tiers.length === 0
                ? 'Label only: no capacity for this transport.'
                : 'Belt or pipe count shows once the pull rate is solved.'}
          </p>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row">
          <button type="submit">{editing ? 'Save link' : 'Create link'}</button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </fieldset>
    </form>
  );
}
