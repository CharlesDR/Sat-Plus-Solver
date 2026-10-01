import type { LpModel, LpTerm } from './types';

/**
 * Serializes an LpModel to CPLEX LP text with safe generated names
 * (x0…, c0…), returning the name maps needed to read results back.
 * Ranged constraints (lo < hi, both finite) become two rows.
 */
export interface LpText {
  text: string;
  /** Generated column name → model variable name. */
  columns: Map<string, string>;
  /** Generated row name → model constraint name. */
  rows: Map<string, string>;
}

function num(n: number): string {
  if (!Number.isFinite(n)) throw new RangeError(`Non-finite LP coefficient: ${n}`);
  return String(n);
}

export function toLpText(model: LpModel): LpText {
  const colOf = new Map<string, string>();
  const columns = new Map<string, string>();
  model.variables.forEach((v, i) => {
    if (colOf.has(v.name)) throw new Error(`Duplicate LP variable "${v.name}"`);
    colOf.set(v.name, `x${i}`);
    columns.set(`x${i}`, v.name);
  });
  const col = (name: string): string => {
    const c = colOf.get(name);
    if (!c) throw new Error(`Unknown LP variable "${name}"`);
    return c;
  };

  // Merge duplicate terms and drop zeros so the text is canonical.
  const expr = (terms: LpTerm[]): string => {
    const merged = new Map<string, number>();
    for (const t of terms) merged.set(t.var, (merged.get(t.var) ?? 0) + t.coef);
    const parts = [...merged]
      .filter(([, c]) => c !== 0)
      .map(([v, c]) => `${c < 0 ? '-' : '+'} ${num(Math.abs(c))} ${col(v)}`);
    if (parts.length === 0)
      return model.variables.length ? `0 ${col(model.variables[0]!.name)}` : '';
    const lines: string[] = [];
    for (let i = 0; i < parts.length; i += 8) lines.push(parts.slice(i, i + 8).join(' '));
    return lines.join('\n   ');
  };

  const out: string[] = [
    model.sense === 'min' ? 'Minimize' : 'Maximize',
    ` obj: ${expr(model.objective)}`,
  ];
  out.push('Subject To');
  const rows = new Map<string, string>();
  let r = 0;
  const row = (constraint: string, body: string) => {
    const name = `c${r++}`;
    rows.set(name, constraint);
    out.push(` ${name}: ${body}`);
  };
  for (const c of model.constraints) {
    const lo = c.lo ?? -Infinity;
    const hi = c.hi ?? Infinity;
    const e = expr(c.terms);
    if (lo === hi) row(c.name, `${e} = ${num(lo)}`);
    else {
      if (lo > -Infinity) row(c.name, `${e} >= ${num(lo)}`);
      if (hi < Infinity) row(c.name, `${e} <= ${num(hi)}`);
    }
  }

  out.push('Bounds');
  for (const v of model.variables) {
    const lo = v.lo ?? 0;
    const hi = v.hi ?? Infinity;
    const c = col(v.name);
    if (lo === -Infinity && hi === Infinity) out.push(` ${c} free`);
    else if (lo === -Infinity) out.push(` -inf <= ${c} <= ${num(hi)}`);
    else if (hi === Infinity) out.push(` ${c} >= ${num(lo)}`);
    else out.push(` ${num(lo)} <= ${c} <= ${num(hi)}`);
  }
  const ints = model.variables.filter((v) => v.integer).map((v) => col(v.name));
  if (ints.length) out.push('Generals', ` ${ints.join(' ')}`);
  out.push('End');
  return { text: out.join('\n'), columns, rows };
}
