/** A status as a coloured pill. The text always says the status; colour only reinforces it. */
export type Tone = 'ok' | 'warn' | 'error' | 'manual' | 'neutral';

const TONE: Record<string, Tone> = {
  ok: 'ok',
  short: 'warn',
  unbounded: 'warn',
  manual: 'manual',
  unreachable: 'error',
  infeasible: 'error',
  error: 'error',
};

export const toneOf = (status: string): Tone => TONE[status] ?? 'neutral';

export function StatusChip({ status, label = status }: { status: string; label?: string }) {
  return <span className={`status-chip ${toneOf(status)}`}>{label}</span>;
}
