/** Solver constants: tolerances, slack costs and pass limits (§3). Split from solve.ts (F1); behavior unchanged. */

/** Tie-break weight on Σx (§3.3): picks a stable plan among equal-cost ones. */
export const REGULARIZER = 1e-9;
/** Sanity cap used to name the direction of an unbounded LP (§3.5). */
export const SANITY_CAP = 1e7;
/** MILP row tolerance of the retry when a plan fails to polish (see `LpOptions`). */
export const TIGHT_MIP_FEASIBILITY = 1e-10;
/** How far the post-MILP polish may move the stage objective, relative (see `polish`). */
export const POLISH_SLACK = 1e-10;
/** Elastic re-solve: cost of 1/min of extra import, in normal-node-equivalents. */
export const IMPORT_SLACK_COST = 0.01;
/** Elastic re-solve: cost of 1/min more of a limited resource (A33), in normal-node-equivalents. */
export const RESOURCE_SLACK_COST = 0.001;
/** Rate a miner fluid supplied from outside is costed at, per m³/min (A69): its standalone plan's cost / rate. */
export const MINER_SUPPLY_COST_RATE = 60;
/** Elastic re-solve: cost of 1/min of a fluid byproduct left over against `avoidFluidByproducts` (A39). */
export const SURPLUS_SLACK_COST = 0.001;
/** Fluids that are easy to dump, so `avoidFluidByproducts` still lets them be left over (A39). */
export const DUMPABLE_FLUIDS: readonly string[] = ['energetic-dark-matter', 'flue-gas', 'steam'];
/** Solution checks (CLAUDE.md): balance within 1e-6, variables ≥ −1e-9, nodes ≤ budget, resources ≤ limit. */
export const BALANCE_TOL = 1e-6;
export const NONNEG_TOL = 1e-9;
/** Smallest positive target or demand rate, per minute: anything below is under the LP's precision. */
export const MIN_RATE = 1e-6;
/** Lexicographic tolerance range and default (§3.3), as fractions: 0.01%–90%, default 0.01%. */
export const MIN_TOLERANCE = 1e-4;
export const MAX_TOLERANCE = 0.9;
export const DEFAULT_TOLERANCE = MIN_TOLERANCE;
/** Absolute floor ε of the lexicographic constraint, so an optimum of 0 still gets some room. */
export const LEX_EPSILON = 1e-6;
/** Default smallest branch kept, in machines (A34): 1% of a machine. */
export const MIN_BRANCH = 0.01;
/** Default smallest flow kept, per minute (A68): a recipe, surplus or import below it is dropped. */
export const MIN_FLOW = 0.001;
/** Most a flow prune drop may worsen any stage of the plan, as a fraction (A68). */
export const MAX_FLOW_COST = 0.01;
/** Most drops the flow prune may try on one plan (A68), each a whole-stack re-solve. */
export const MAX_FLOW_SOLVES = 6;
/** Most LP solves the prune pass may spend on one plan (A34). */
export const MAX_PRUNE_ATTEMPTS = 24;
/** Most an objective may lose to simplicity (A73), relative to the first solve's plan. */
export const SIMPLICITY_CAP = 0.01;
/** The farm cap the app uses (A86): a byproduct farm goes when that costs at most 10%. */
export const FARM_CAP = 0.1;
/** Most farm drops the simplicity pass tries (A86). */
export const MAX_FARM_SOLVES = 4;
/** Most stack re-solves the simplicity pass makes (A73). */
export const MAX_SIMPLIFY_SOLVES = 12;
/** The simplicity pass (A73) stops after this many rejected re-solves in a row. */
export const MAX_SIMPLIFY_MISSES = 3;
/** Most first-stage bound LPs the simplicity pass makes (A73). */
export const MAX_SIMPLIFY_BOUNDS = 40;
/** A recipe below this fraction of the plan's largest is rounding error (A73). */
export const NOISE = 1e-6;
/** Tidy weight of a conversion generator (C1, A73): far below a machine, above nothing. */
export const CONVERSION_TIDY_WEIGHT = 1e-3;
/** Default time limit of a MILP stage, in seconds (§3.4). */
export const MILP_TIME_LIMIT_SECONDS = 5;
/** Elastic slack below this is solver noise, not a relaxation. */
export const SLACK_TOL = 1e-9;

/** Most re-costing rounds of `solveCosted` before it settles for the best plan seen. */
export const MAX_COST_ROUNDS = 4;
