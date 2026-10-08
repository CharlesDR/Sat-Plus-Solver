/**
 * Export-to-file and share-link buttons for a world: the whole save, or the
 * one-factory world of "share this factory only". A world too big for a link
 * is offered as a file instead (PLAN M9).
 */
import { serializeWorld, type World } from '@sps/world';
import { useState } from 'react';
import { useToast } from '../ui/toasts';
import { shareLink, type ShareLink } from './share';

/** A file name from a display name: "Plate Works" → "plate-works.json". */
export function fileName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'world'}.json`;
}

/** A Modeler file name (M14): "Plate Works" → "plate-works.sfmd". */
export function modelerFileName(name: string): string {
  return fileName(name).replace(/\.json$/, '.sfmd');
}

/** Offers `text` as a file download. */
export function downloadText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

export function ShareControls(props: {
  /** Builds the world to share when a button is pressed. */
  world: () => World;
  /** Display name for the file name. */
  name: string;
  /** "world" or "this factory", for the button labels. */
  what: string;
  disabled?: boolean;
}) {
  const { world, name, what, disabled } = props;
  const [link, setLink] = useState<ShareLink>();
  const [copied, setCopied] = useState<boolean>();
  const toast = useToast();
  const exportFile = () => downloadText(fileName(name), serializeWorld(world(), true));
  const share = () => {
    const out = shareLink(world(), window.location.href);
    setLink(out);
    setCopied(undefined);
    if (!out.ok) return;
    // The clipboard may be refused (permissions, insecure context); the link is shown either way.
    navigator.clipboard?.writeText(out.url).then(
      () => {
        setCopied(true);
        toast('Share link copied to the clipboard.');
      },
      () => setCopied(false),
    );
  };

  return (
    <div className="share">
      <div className="row">
        <button type="button" onClick={exportFile} disabled={disabled}>
          Export {what}
        </button>
        <button type="button" onClick={share} disabled={disabled}>
          Share link to {what}
        </button>
      </div>
      {link?.ok && (
        <p className="share-link">
          <label>
            Share link ({kb(link.bytes)})
            <input readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} />
          </label>
          <span role="status">
            {copied === true
              ? 'Copied to the clipboard.'
              : copied === false
                ? 'Copy the link above.'
                : ''}
          </span>
        </p>
      )}
      {link && !link.ok && (
        <p className="warning" role="alert">
          This is too big for a link ({kb(link.bytes)} compressed; links hold under {kb(link.limit)}
          ). Export it as a file instead.{' '}
          <button type="button" onClick={exportFile}>
            Export file
          </button>
        </p>
      )}
    </div>
  );
}
