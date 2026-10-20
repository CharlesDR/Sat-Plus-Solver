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

/** An LpModel as HiGHS column and row arrays (`passModel`), with the names to read results back. */
export interface LpArrays {
  numCols: number;
  numRows: number;
  sense: 'min' | 'max';
  colCost: Float64Array;
  colLower: Float64Array;
  colUpper: Float64Array;
  rowLower: Float64Array;
  rowUpper: Float64Array;
  /** Row-wise (CSR) constraint matrix. */
  starts: Int32Array;
  indices: Int32Array;
  values: Float64Array;
  integrality: Int32Array;
  /** Column index → model variable name. */
  columns: string[];
  /** Row index → model constraint name. */
  rows: string[];
}

/**
 * The same model `toLpText` writes, as arrays HiGHS takes without parsing
 * text (T1): parsing was most of a solve's time. Columns come in the order
 * HiGHS's LP reader creates them (first use in the objective, then in the
 * constraints, then the rest in variable order), and rows as the text
 * writes them, so HiGHS solves the identical model and returns the same plan.
 */
export function toLpArrays(model: LpModel): LpArrays {
  const known = new Map(model.variables.map((v) => [v.name, v]));
  if (known.size !== model.variables.length) {
    const seen = new Set<string>();
    for (const v of model.variables) {
      if (seen.has(v.name)) throw new Error(`Duplicate LP variable "${v.name}"`);
      seen.add(v.name);
    }
  }
  const index = new Map<string, number>();
  const columns: string[] = [];
  const use = (name: string): number => {
    let i = index.get(name);
    if (i === undefined) {
      if (!known.has(name)) throw new Error(`Unknown LP variable "${name}"`);
      i = columns.length;
      index.set(name, i);
      columns.push(name);
    }
    return i;
  };
  // Merge duplicate terms and drop zeros, as the text does.
  const merged = (terms: LpTerm[]): [string, number][] => {
    const m = new Map<string, number>();
    for (const t of terms) {
      num(t.coef);
      m.set(t.var, (m.get(t.var) ?? 0) + t.coef);
    }
    const out = [...m].filter(([, c]) => c !== 0);
    // An empty expression is written as `0 x0`, which creates the first column.
    if (!out.length && model.variables.length) use(model.variables[0]!.name);
    for (const [v] of out) use(v);
    return out;
  };
  const objective = merged(model.objective);
  const rowTerms: [string, number][][] = [];
  const rowLower: number[] = [];
  const rowUpper: number[] = [];
  const rows: string[] = [];
  const bound = (n: number) => {
    if (Number.isNaN(n)) throw new RangeError(`Non-finite LP coefficient: ${n}`);
    return n;
  };
  for (const c of model.constraints) {
    const lo = c.lo ?? -Infinity;
    const hi = c.hi ?? Infinity;
    const terms = merged(c.terms);
    const row = (l: number, h: number) => {
      rowTerms.push(terms);
      rowLower.push(bound(l));
      rowUpper.push(bound(h));
      rows.push(c.name);
    };
    if (lo === hi) row(Number(num(lo)), hi);
    else {
      if (lo > -Infinity) row(lo, Infinity);
      if (hi < Infinity) row(-Infinity, hi);
    }
  }
  for (const v of model.variables) use(v.name);
  const n = columns.length;
  const colCost = new Float64Array(n);
  for (const [v, c] of objective) colCost[index.get(v)!] = c;
  const colLower = new Float64Array(n);
  const colUpper = new Float64Array(n);
  const integrality = new Int32Array(n);
  columns.forEach((name, i) => {
    const v = known.get(name)!;
    colLower[i] = bound(v.lo ?? 0);
    colUpper[i] = bound(v.hi ?? Infinity);
    integrality[i] = v.integer ? 1 : 0;
  });
  const nnz = rowTerms.reduce((s, t) => s + t.length, 0);
  const starts = new Int32Array(rows.length + 1);
  const indices = new Int32Array(nnz);
  const values = new Float64Array(nnz);
  let k = 0;
  rowTerms.forEach((terms, r) => {
    for (const [v, c] of terms) {
      indices[k] = index.get(v)!;
      values[k++] = c;
    }
    starts[r + 1] = k;
  });
  return {
    numCols: n,
    numRows: rows.length,
    sense: model.sense,
    colCost,
    colLower,
    colUpper,
    rowLower: Float64Array.from(rowLower),
    rowUpper: Float64Array.from(rowUpper),
    starts,
    indices,
    values,
    integrality,
    columns,
    rows,
  };
}
