/**
 * Opening a copy of the open world (DF-13, A109): says whether it is newer
 * or older, with both saved times, and offers Replace, Keep both or Cancel.
 */
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { savedTime, type CopyCheck } from './copies';

const HEADINGS: Record<CopyCheck['age'], string> = {
  newer: 'A newer copy of this world',
  older: 'An older copy of this world',
  same: 'The same copy of this world',
};

const WHEN: Record<CopyCheck['age'], string> = {
  newer: 'It was saved after the world you have open.',
  older: 'It was saved before the world you have open.',
  same: 'Both were saved at the same time.',
};

export function CopyDialog(props: {
  check: CopyCheck;
  /** What is being opened, as a sentence's subject: "This share link", "The file “a.json”". */
  what: string;
  /** False when there are no local saves to keep the open world in. */
  canKeepBoth: boolean;
  /** Why Keep both failed, if it did. */
  error?: string | undefined;
  onReplace(): void;
  onKeepBoth(): void;
  onCancel(): void;
}) {
  const { check, what, canKeepBoth, error, onReplace, onKeepBoth, onCancel } = props;
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  const heading = HEADINGS[check.age];

  return createPortal(
    <div className="palette-backdrop" onMouseDown={onCancel}>
      <div
        className="palette-dialog copy-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={heading}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return;
          e.preventDefault();
          onCancel();
        }}
      >
        <h2>{heading}</h2>
        <p>
          {what} is a copy of the world you have open. {WHEN[check.age]}
        </p>
        <dl className="copy-times">
          <dt>Opening</dt>
          <dd>saved {savedTime(check.incoming)}</dd>
          <dt>Open now</dt>
          <dd>saved {savedTime(check.open)}</dd>
        </dl>
        <p className="hint">
          Replace opens it, and the world you have open becomes the previous world (File › Restore
          previous world).{' '}
          {canKeepBoth
            ? 'Keep both saves the world you have open to a local save first.'
            : 'This browser does not allow local saves, so Keep both is off.'}
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row dialog-actions">
          <button
            type="button"
            ref={check.age === 'newer' ? undefined : first}
            className={check.age === 'newer' ? undefined : 'primary'}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button type="button" onClick={onKeepBoth} disabled={!canKeepBoth}>
            Keep both
          </button>
          <button
            type="button"
            ref={check.age === 'newer' ? first : undefined}
            className={check.age === 'newer' ? 'primary' : undefined}
            onClick={onReplace}
          >
            Replace
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
