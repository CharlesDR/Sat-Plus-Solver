/**
 * BF-1 (A104): asks before a link edit takes a held built factory's fixed
 * links above what its build makes for links. "Yes, proceed" applies the
 * edit and scales the factory up, with the held factories upstream that
 * scale with it; "Cancel" leaves the link as it was.
 */
import { formatRate as fmt } from '@sps/solver';
import type { Overrun } from '@sps/world';
import { useEffect, useRef } from 'react';

const list = (names: string[]) =>
  names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

export function GrowDialog(props: {
  overruns: readonly Overrun[];
  factoryName(id: string): string;
  itemName(id: string): string;
  onProceed(): void;
  onCancel(): void;
}) {
  const { overruns, factoryName, itemName, onProceed, onCancel } = props;
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => cancel.current?.focus(), []);
  const grown = [...new Set(overruns.map((o) => o.factory))];
  const upstream = [...new Set(overruns.flatMap((o) => o.upstream))].filter(
    (id) => !grown.includes(id),
  );
  const title = `Scale up ${list(grown.map(factoryName))}?`;
  return (
    <div className="palette-backdrop" onMouseDown={onCancel}>
      <div
        className="palette-dialog grow-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return;
          e.preventDefault();
          onCancel();
        }}
      >
        <h2>{title}</h2>
        {overruns.map((o) => (
          <p key={`${o.factory}\n${o.item}`}>
            Fixed links would take <span className="num">{fmt(o.fixed)}</span>/min of{' '}
            {itemName(o.item)} from <strong>{factoryName(o.factory)}</strong>, but its build makes{' '}
            <span className="num">{fmt(o.cap)}</span>/min for links.
          </p>
        ))}
        <p>
          {list(grown.map(factoryName))} will be scaled up
          {upstream.length ? `, with ${list(upstream.map(factoryName))} upstream,` : ''} and will no
          longer match what is built in game.
        </p>
        <div className="row dialog-actions">
          <button type="button" ref={cancel} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={onProceed}>
            Yes, proceed
          </button>
        </div>
      </div>
    </div>
  );
}
