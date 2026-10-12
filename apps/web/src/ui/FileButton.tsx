import { useRef } from 'react';
import { FileIcon } from './icons';

/**
 * A styled "choose a file" button (B10): a button that opens a hidden file
 * input. The input keeps `label` as its accessible name, so the file still
 * goes in by label (tests, assistive tech); the button carries the focus.
 */
export function FileButton(props: {
  label: string;
  accept: string;
  disabled?: boolean;
  onFile(file: File | undefined): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <span className="file-button-wrap">
      <input
        ref={input}
        type="file"
        className="visually-hidden"
        tabIndex={-1}
        aria-label={props.label}
        accept={props.accept}
        disabled={props.disabled}
        onChange={(e) => {
          props.onFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        className="file-button"
        disabled={props.disabled}
        onClick={() => input.current?.click()}
      >
        <FileIcon /> {props.label}
      </button>
    </span>
  );
}
