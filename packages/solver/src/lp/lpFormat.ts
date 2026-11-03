import type { LpModel, LpTerm } from './types';

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
 * The model as arrays HiGHS takes without parsing LP text (T1, A94): parsing
 * was most of a solve's time. Columns come in the order HiGHS's LP reader
 * created them (first use in the objective, then in the constraints, then
 * the rest in variable order), duplicate terms merged and zeros dropped, and
 * a ranged row (both bounds finite and different) is two rows, so the plans
 * stay those the LP text gave. An empty expression uses the first column, as
 * the text's `0 x0` did.
 */
export function toLpArrays(model: LpModel): LpArrays {
  const vars = model.variables;
  const nv = vars.length;
  const known = new Map<string, number>();
  vars.forEach((v, i) => {
    if (known.has(v.name)) throw new Error(`Duplicate LP variable "${v.name}"`);
    known.set(v.name, i);
  });
  // Variable index → column index (-1 until first used), and back (BR-1:
  // index arrays instead of maps keyed by name).
  const colOf = new Int32Array(nv).fill(-1);
  const varOf: number[] = [];
  const use = (vi: number) => {
    if (colOf[vi]! < 0) {
      colOf[vi] = varOf.length;
      varOf.push(vi);
    }
  };
  const finite = (n: number) => {
    if (!Number.isFinite(n)) throw new RangeError(`Non-finite LP coefficient: ${n}`);
    return n;
  };
  const bound = (n: number) => {
    if (Number.isNaN(n)) throw new RangeError(`Non-finite LP coefficient: ${n}`);
    return n;
  };
  // Scratch for merging duplicate terms: a sum per variable, and whether it is in use.
  const sum = new Float64Array(nv);
  const seen = new Uint8Array(nv);
  /** Terms merged per variable in first-use order, zeros dropped: [var, coef, var, coef, …]. */
  const merged = (terms: readonly LpTerm[]): number[] => {
    const order: number[] = [];
    for (const t of terms) {
      finite(t.coef);
      const vi = known.get(t.var);
      if (vi === undefined) throw new Error(`Unknown LP variable "${t.var}"`);
      if (seen[vi]) sum[vi]! += t.coef;
      else {
        seen[vi] = 1;
        sum[vi] = t.coef;
        order.push(vi);
      }
    }
    const out: number[] = [];
    for (const vi of order) {
      seen[vi] = 0;
      if (sum[vi] !== 0) out.push(vi, sum[vi]!);
    }
    // An empty expression is written as `0 x0`, which creates the first column.
    if (!out.length && nv) use(0);
    for (let k = 0; k < out.length; k += 2) use(out[k]!);
    return out;
  };
  const objective = merged(model.objective);
  const rowTerms: number[][] = [];
  const rowLower: number[] = [];
  const rowUpper: number[] = [];
  const rows: string[] = [];
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
    if (lo === hi) row(finite(lo), hi);
    else {
      if (lo > -Infinity) row(lo, Infinity);
      if (hi < Infinity) row(-Infinity, hi);
    }
  }
  for (let vi = 0; vi < nv; vi++) use(vi);
  const n = varOf.length;
  const colCost = new Float64Array(n);
  for (let k = 0; k < objective.length; k += 2) colCost[colOf[objective[k]!]!] = objective[k + 1]!;
  const colLower = new Float64Array(n);
  const colUpper = new Float64Array(n);
  const integrality = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const v = vars[varOf[i]!]!;
    colLower[i] = bound(v.lo ?? 0);
    colUpper[i] = bound(v.hi ?? Infinity);
    integrality[i] = v.integer ? 1 : 0;
  }
  let nnz = 0;
  for (const t of rowTerms) nnz += t.length / 2;
  const starts = new Int32Array(rows.length + 1);
  const indices = new Int32Array(nnz);
  const values = new Float64Array(nnz);
  let at = 0;
  rowTerms.forEach((t, r) => {
    for (let k = 0; k < t.length; k += 2) {
      indices[at] = colOf[t[k]!]!;
      values[at++] = t[k + 1]!;
    }
    starts[r + 1] = at;
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
    columns: varOf.map((vi) => vars[vi]!.name),
    rows,
  };
}
