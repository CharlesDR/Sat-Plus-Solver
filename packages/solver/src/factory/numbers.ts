/**
 * How the app writes numbers (A41, Charles 2026-10-07): machine counts and
 * rates show 1 to 4 decimal places, rounded up (away from zero) to the next
 * 0.0001, with commas between thousands. Where the value is a simple fraction
 * the decimals can't show exactly, the exact mixed number goes with it
 * ("2.3334 (2 1/3)").
 */

/** Places shown at most, and the step values round up to. */
const PLACES = 4;
const STEP = 10 ** PLACES;
/**
 * Solver noise below this (relative to the value, at least absolute, and at
 * most 1% of a step) is not rounded up: 60.00000001 is 60.0, not 60.0001.
 */
const NOISE = 1e-9;
const MAX_NOISE_STEPS = 0.01;
/** Largest denominator shown in an exact fraction. */
export const MAX_DENOMINATOR = 1000;
/** How close a fraction must be to the value to count as exact. */
const EXACT = 1e-9;

/** Commas between thousands in a plain decimal string ("-1234.5" → "-1,234.5"). */
export function groupThousands(s: string): string {
  const [whole = '', frac] = s.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac === undefined ? grouped : `${grouped}.${frac}`;
}

/**
 * A rate or machine count: 1 to 4 decimals, rounded up away from zero to the
 * next 0.0001 (1/3 → "0.3334", 60 → "60.0", 1555.5556 → "1,555.5556").
 */
export function formatRate(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const size = Math.abs(n);
  const noise = Math.min(NOISE * Math.max(1, size) * STEP, MAX_NOISE_STEPS);
  const steps = Math.ceil(size * STEP - noise);
  if (steps <= 0) return '0.0';
  const whole = Math.floor(steps / STEP);
  const frac = String(steps % STEP)
    .padStart(PLACES, '0')
    .replace(/0+$/, '');
  return `${n < 0 ? '-' : ''}${groupThousands(String(whole))}.${frac || '0'}`;
}

/** A value as a whole part plus a proper fraction, both carrying the sign. */
export interface MixedNumber {
  negative: boolean;
  whole: number;
  numerator: number;
  denominator: number;
}

/**
 * The simplest fraction with a denominator up to `MAX_DENOMINATOR` that equals
 * `n` to within 1e-9 (relative), or undefined if there is none. Found with
 * continued fractions, so it is the lowest-terms best approximation.
 */
export function exactFraction(n: number): MixedNumber | undefined {
  if (!Number.isFinite(n)) return undefined;
  const x = Math.abs(n);
  const tolerance = EXACT * Math.max(1, x);
  // Convergents h/k of the continued fraction of x.
  let [h0, h1, k0, k1] = [0, 1, 1, 0];
  let rest = x;
  for (let step = 0; step < 64; step++) {
    const a = Math.floor(rest);
    [h0, h1] = [h1, a * h1 + h0];
    [k0, k1] = [k1, a * k1 + k0];
    if (k1 > MAX_DENOMINATOR) return undefined;
    if (Math.abs(h1 / k1 - x) <= tolerance) {
      return {
        negative: n < 0 && h1 !== 0,
        whole: Math.floor(h1 / k1),
        numerator: h1 % k1,
        denominator: k1,
      };
    }
    const frac = rest - a;
    if (frac < 1e-15) return undefined;
    rest = 1 / frac;
  }
  return undefined;
}

/** "2 1/3", "1/3", "-1 1/2"; a whole number has no fraction part ("4"). */
export function mixedText(m: MixedNumber): string {
  const sign = m.negative ? '-' : '';
  if (m.numerator === 0) return `${sign}${groupThousands(String(m.whole))}`;
  const part = `${m.numerator}/${m.denominator}`;
  return m.whole === 0 ? `${sign}${part}` : `${sign}${groupThousands(String(m.whole))} ${part}`;
}

/**
 * The exact mixed number for `n`, but only when the 4-decimal text can't show
 * it exactly (1/3 → "1/3"; 2.5 and 60 → undefined).
 */
export function exactText(n: number): string | undefined {
  const m = exactFraction(n);
  if (!m || m.numerator === 0) return undefined;
  // Exact in 4 decimals when the denominator divides 10^4.
  if (STEP % m.denominator === 0) return undefined;
  return mixedText(m);
}

/** A machine count or rate with its exact fraction when that adds anything: "2.3334 (2 1/3)". */
export function formatExact(n: number): string {
  const exact = exactText(n);
  return exact === undefined ? formatRate(n) : `${formatRate(n)} (${exact})`;
}
