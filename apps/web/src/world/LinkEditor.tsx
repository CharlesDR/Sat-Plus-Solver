/**
 * The link editor (PLAN M8): from and to factories, the item, `fixed` or
 * `pull`, and the transport with its belt or pipe count. Opened by dragging
 * between two factories on the canvas, by "Add link", or by "Edit" in the
 * link table. The part is picked from the source's products, or any part
 * under "Other…" (UX-18); a drag from a part's port pre-fills it (A80). A
 * new link of a part the source has spare starts fixed at that amount, so
 * the source doesn't grow; one with none starts as pull (DF-4).
 */
import { formatRate as fmt } from '@sps/solver';
import type { Link, LinkSpec, Transport, World } from '@sps/world';
import { useEffect, useId, useRef, useState } from 'react';
import { Field } from '../controls/Field';
import { useItemLookup } from '../controls/itemRows';
import type { Catalog, WorldSummary } from '../solver/protocol';
import { SHOW_TRANSPORT } from '../flags';
import {
  availableFrom,
  carriersFor,
  fixedDefault,
  productsOf,
  spareFrom,
  transportTiers,
} from './viewModel';

const TRANSPORTS: { kind: Transport; label: string }[] = [
  { kind: 'unspecified', label: 'Unspecified' },
  { kind: 'belt', label: 'Belt' },
  { kind: 'pipe', label: 'Pipe' },
  { kind: 'train', label: 'Train' },
  { kind: 'truck', label: 'Truck' },
  { kind: 'drone', label: 'Drone' },
];

/** A link being drawn: a new one between two factories, or an existing one. */
export type LinkDraft = { from: string; to: string; link?: Link; item?: string };

/** The Part select's entry that opens the search over every part. */
const OTHER = '\u0000other';

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
  const [from, pickFrom] = useState(draft.from);
  const [to, setTo] = useState(draft.to);
  const productsFrom = (f: string) =>
    productsOf(summary, f).sort((a, b) => items.name(a).localeCompare(items.name(b)));
  const products = productsFrom(from);
  const start = link?.item ?? draft.item;
  const [choice, setChoice] = useState(
    start === undefined ? '' : products.includes(start) ? start : OTHER,
  );
  const [itemText, setItemText] = useState(
    start !== undefined && !products.includes(start) ? items.name(start) : '',
  );
  // A new link's mode and rate follow its source and part until the user sets them (DF-4).
  const spareDefault = (f: string, part: string | undefined) => {
    const r = part === undefined ? 0 : fixedDefault(spareFrom(summary, f, part));
    return r > 0
      ? { mode: 'fixed' as const, rate: String(r) }
      : { mode: 'pull' as const, rate: '60' };
  };
  const initial = link
    ? {
        mode: link.mode.kind,
        rate: link.mode.kind === 'fixed' ? String(link.mode.rate) : '60',
      }
    : spareDefault(draft.from, start);
  const [mode, setModeState] = useState<'pull' | 'fixed'>(initial.mode);
  const [rateText, setRateTextState] = useState(initial.rate);
  const [modeSet, setModeSet] = useState(false);
  const setMode = (m: 'pull' | 'fixed') => {
    setModeSet(true);
    setModeState(m);
  };
  const setRateText = (t: string) => {
    setModeSet(true);
    setRateTextState(t);
  };
  const followSpare = (f: string, part: string | undefined) => {
    if (link || modeSet) return;
    const d = spareDefault(f, part);
    setModeState(d.mode);
    setRateTextState(d.rate);
  };
  // A part pre-filled by a drag (A80) gets belts or pipes, as a picked one does.
  const startKind: Transport =
    link?.transport?.kind ??
    (draft.item !== undefined ? (fluids.has(draft.item) ? 'pipe' : 'belt') : 'unspecified');
  const [kind, setKind] = useState<Transport>(startKind);
  const [tier, setTier] = useState<number | undefined>(
    link ? link.transport?.tier : transportTiers(catalog, startKind)[0]?.tier,
  );
  const [error, setError] = useState<string>();
  // The form opens below the canvas: bring it into view with the part to pick focused.
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const form = formRef.current;
    form?.scrollIntoView?.({ block: 'nearest' });
    form?.querySelector<HTMLSelectElement>('select[data-part]')?.focus({ preventScroll: true });
  }, []);

  const item = choice === OTHER ? items.find(itemText) : choice ? { id: choice } : undefined;
  const rate = Number(rateText);
  const rateOk = rateText.trim() !== '' && Number.isFinite(rate) && rate >= 0;
  const tiers = transportTiers(catalog, kind);
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
  // A fresh link picks belts or pipes for what it carries.
  const carrierFor = (id: string | undefined) => {
    if (id !== undefined && !link && (kind === 'unspecified' || kind === 'belt' || kind === 'pipe'))
      pickKind(fluids.has(id) ? 'pipe' : 'belt');
  };
  const pickItem = (text: string) => {
    setItemText(text);
    const id = items.find(text)?.id;
    carrierFor(id);
    followSpare(from, id);
  };
  const pick = (value: string) => {
    setChoice(value);
    if (value !== OTHER) {
      carrierFor(value || undefined);
      followSpare(from, value || undefined);
    }
  };
  // Another source has other products: a part it doesn't list moves to Other.
  const setFrom = (f: string) => {
    pickFrom(f);
    if (choice !== OTHER && choice !== '' && !productsFrom(f).includes(choice)) {
      setChoice(OTHER);
      setItemText(items.name(choice));
    }
    followSpare(f, item?.id);
  };

  const save = () => {
    if (!item)
      return setError(
        `Pick a part${choice === OTHER && itemText ? `: no part named “${itemText}”` : ''}.`,
      );
    if (mode === 'fixed' && !rateOk) return setError('A fixed link needs a rate of 0 or more.');
    const spec: LinkSpec = {
      from,
      to,
      item: item.id,
      mode: mode === 'fixed' ? { kind: 'fixed', rate } : { kind: 'pull' },
      // With transport hidden, an edit keeps what the link had and a new link writes none.
      ...(!SHOW_TRANSPORT
        ? link?.transport
          ? { transport: link.transport }
          : {}
        : kind !== 'unspecified'
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
      ref={formRef}
      className="controls link-editor pane-in"
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
          <Field label="Part">
            {(id) => (
              <select id={id} data-part value={choice} onChange={(e) => pick(e.target.value)}>
                <option value="">Pick a part…</option>
                {products.map((p) => {
                  // What its targets leave for links (A92): "x of y available";
                  // a byproduct's surplus: "x/min spare" (DF-4).
                  const a = availableFrom(summary, from, p);
                  const spare = a ? 0 : spareFrom(summary, from, p);
                  return (
                    <option key={p} value={p}>
                      {items.name(p)}
                      {a
                        ? ` (${fmt(a.spare)} of ${fmt(a.forLinks)} available)`
                        : spare > 0
                          ? ` (${fmt(spare)}/min spare)`
                          : ''}
                    </option>
                  );
                })}
                <option value={OTHER}>Other…</option>
              </select>
            )}
          </Field>
          {choice === OTHER && (
            <Field label="Other part">
              {(id) => (
                <input
                  id={id}
                  list={listId}
                  value={itemText}
                  placeholder="Search parts…"
                  aria-invalid={itemText.trim() !== '' && !item}
                  onChange={(e) => pickItem(e.target.value)}
                />
              )}
            </Field>
          )}
          <datalist id={listId}>
            {catalog.items.map((c) => (
              <option key={c.id} value={c.name} />
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
        {SHOW_TRANSPORT && (
          <div className="row">
            <Field label="Transport">
              {(id) => (
                <select
                  id={id}
                  value={kind}
                  onChange={(e) => pickKind(e.target.value as Transport)}
                >
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
        )}
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
