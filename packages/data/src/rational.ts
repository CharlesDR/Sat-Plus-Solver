/**
 * Exact rational arithmetic on bigints. Dataset amounts and batch times are
 * parsed into rationals and only converted to floats at the end of
 * normalization (CLAUDE.md: "exact rational").
 */
export interface Rational {
  readonly n: bigint; // numerator, carries the sign
  readonly d: bigint; // denominator, always > 0
}

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

export function rat(n: bigint | number, d: bigint | number = 1n): Rational {
  let nn = BigInt(n);
  let dd = BigInt(d);
  if (dd === 0n) throw new RangeError('Rational with zero denominator');
  if (dd < 0n) {
    nn = -nn;
    dd = -dd;
  }
  const g = gcd(nn, dd) || 1n;
  return { n: nn / g, d: dd / g };
}

export const ZERO = rat(0);
export const ONE = rat(1);

const DECIMAL = /^(-)?(\d+)(?:\.(\d+))?$/;
const FRACTION = /^(-)?(\d+)\/(\d+)$/;
const MIXED = /^(-)?(\d+) (\d+)\/(\d+)$/;

/**
 * Parses `"3"`, `"-7.5"`, `"1/3"`, `"10/3"` and mixed numbers like `"1 1/3"`.
 * Returns `undefined` for anything else (callers turn that into a validation error).
 */
export function parseRational(text: string): Rational | undefined {
  const s = text.trim();
  let m = DECIMAL.exec(s);
  if (m) {
    const [, sign, int, frac = ''] = m;
    const r = rat(BigInt(int! + frac), 10n ** BigInt(frac.length));
    return sign ? neg(r) : r;
  }
  m = FRACTION.exec(s);
  if (m) {
    const [, sign, num, den] = m;
    if (BigInt(den!) === 0n) return undefined;
    const r = rat(BigInt(num!), BigInt(den!));
    return sign ? neg(r) : r;
  }
  m = MIXED.exec(s);
  if (m) {
    const [, sign, whole, num, den] = m;
    if (BigInt(den!) === 0n) return undefined;
    const r = add(rat(BigInt(whole!)), rat(BigInt(num!), BigInt(den!)));
    return sign ? neg(r) : r;
  }
  return undefined;
}

export const add = (a: Rational, b: Rational): Rational => rat(a.n * b.d + b.n * a.d, a.d * b.d);
export const sub = (a: Rational, b: Rational): Rational => rat(a.n * b.d - b.n * a.d, a.d * b.d);
export const mul = (a: Rational, b: Rational): Rational => rat(a.n * b.n, a.d * b.d);
export const div = (a: Rational, b: Rational): Rational => {
  if (b.n === 0n) throw new RangeError('Division by zero');
  return rat(a.n * b.d, a.d * b.n);
};
export const neg = (a: Rational): Rational => rat(-a.n, a.d);
export const abs = (a: Rational): Rational => (a.n < 0n ? neg(a) : a);
export const cmp = (a: Rational, b: Rational): number => {
  const diff = a.n * b.d - b.n * a.d;
  return diff < 0n ? -1 : diff > 0n ? 1 : 0;
};
export const eq = (a: Rational, b: Rational): boolean => a.n === b.n && a.d === b.d;
export const max = (a: Rational, b: Rational): Rational => (cmp(a, b) >= 0 ? a : b);
export const isNegative = (a: Rational): boolean => a.n < 0n;
export const isZero = (a: Rational): boolean => a.n === 0n;

export function toNumber(a: Rational): number {
  return Number(a.n) / Number(a.d);
}

export function toString(a: Rational): string {
  return a.d === 1n ? `${a.n}` : `${a.n}/${a.d}`;
}
