/**
 * What form an item flows in (A48), for colouring the flowchart's lines and
 * ports. The dataset flags fluids but not gases, so the gases are listed
 * here by item id; a tooling test checks each is a fluid in the model.
 */
export type FlowForm = 'solid' | 'fluid' | 'gas';

export const GASES: ReadonlySet<string> = new Set([
  'air',
  'chlorine-gas',
  'condensed-neutrium-gas',
  'energetic-dark-matter',
  'ethylene-gas',
  'excited-photonic-matter',
  'flue-gas',
  'hydrogen',
  'natural-gas',
  'nitrogen-gas',
  'sour-gas',
  'steam',
  'ticl-gas',
  'toxic-air',
]);

/** `fluids`: the model's fluid item ids (gases included). */
export function flowForm(item: string, fluids: ReadonlySet<string>): FlowForm {
  if (GASES.has(item)) return 'gas';
  return fluids.has(item) ? 'fluid' : 'solid';
}
