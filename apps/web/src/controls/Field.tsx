import { useId, type ReactNode } from 'react';

/**
 * A labeled control whose accessible name is just its label (a control nested
 * inside its <label> would also take the control's own text, e.g. every
 * option of a select).
 */
export function Field(props: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      {props.children(id)}
    </div>
  );
}
