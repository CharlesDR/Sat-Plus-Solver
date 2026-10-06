# CLAUDE.md

A client-side, two-layer production planner for the Satisfactory Plus (SF+) mod. The outer layer is a world of factories joined by links; inside each factory is an LP/MILP solver with satisfactory-tools parity.

**Read first:** `docs/ARCHITECTURE.md` (design) and `docs/PLAN.md` (milestones M0–M11). They are the source of truth. If code and docs disagree, stop and ask; don't silently pick one.

## Working rules

- **One milestone at a time, in PLAN order.** A milestone is done only when every acceptance criterion in `docs/PLAN.md` passes. Don't start the next one before then.
- **Stop at the review checkpoints** (after M1, M3, M5) and wait for the user.
- **Change the design in the docs first.** If implementation shows the design is wrong, propose the change to `ARCHITECTURE.md`/`PLAN.md` and get approval before diverging. Record new assumptions in ARCHITECTURE §10 with the next `A#`/`R#` id.
- **Never weaken a test to make it pass.** That means no loosening tolerances, deleting cases, skipping or `.only`-ing tests, or editing golden fixtures to match new output. A golden fixture changes only with the user's explicit approval, and the commit must say why.
- Before each commit: `pnpm lint && pnpm typecheck && pnpm test` (and `pnpm build:data` when anything under `packages/data` or `data/` changed). Planned commands; created in M0.

## Non-negotiables

### Data

- **`game_data.json`, `data.schema.json` and `Nodecount Sat Plus.xlsx` are read-only.** Fixes go in `data/overrides.json`, `data/miner-model.json` or `data/nodes.csv`, each with a comment or report entry explaining why.
- Parse every `Amount`/`BatchTime` as an **exact rational** (supports `"3"`, `"7.5"`, `"1/3"`, `"1 1/3"`). Convert to float once, at the end of normalization.
- Validation errors **fail the build**. Never downgrade an error to a warning to get past it.
- Miner rates come only from the formula in ARCHITECTURE §2.3, using the parameters in `data/miner-model.json`. No hard-coded rate numbers in code.

### Units and sign conventions (canonical model)

- Items: **per minute**. Fluids: **m³ per minute**. Power: **MW, positive = consumption, negative = generation**.
- Recipe `inputs[]`/`outputs[]` hold **positive** rates. Raw signs never leave `packages/data`.
- Generator recipes output the `MW` pseudo-item. A machine's own draw is never an `MW` input.

### Architecture boundaries

- Dependency direction: `data ← solver ← world ← web`. `graph` may depend only on the result types from `solver`/`world`. Enforced by ESLint; never disable the rule.
- `solver`, `world` and `graph` are **pure TypeScript**: no DOM, React, `window`, storage, or network. All randomness and time are injected.
- Only `solver` builds LP rows. HiGHS is reached only through the `LpBackend` interface, never imported directly elsewhere.
- Solving runs in a Web Worker in the web app. The main thread never runs the LP.
- The Zustand store holds the `World` document, which is also the save/share format. Any shape change bumps `World.v` and adds a migration plus a migration test.

### Solver correctness

- Every solve result is checked before it is returned: item balance within 1e-6, all variables ≥ −1e-9, node usage ≤ budget. A failed check is an error, not a warning. A factory in manual mode (A36) is not solved, so this does not apply to it; its plan is labelled "not solver-checked".
- Handle every HiGHS status (`Optimal`, `Infeasible`, `Unbounded`, time limit, numerical errors) explicitly, with the user-facing diagnostics in ARCHITECTURE §3.5.
- Lexicographic tolerance input is clamped to **0.01%–90%, default 0.01%**.
- Results must be deterministic: identical input gives identical output, including tie-breaking and graph layout.

### IDs and persistence

- Recipe/item IDs are stable slugs (with a content-hash suffix on collisions). Never use array indices as persisted IDs.
- Saves carry `v` and `dataHash`. A `dataHash` mismatch warns and still loads.
- Wrap every `localStorage` access in try/catch. The app must work without storage.

## Conventions

- TypeScript strict; no `any` without an explanatory comment. Prefer plain data plus functions over classes in `solver`/`world`.
- Tests sit next to code (`*.test.ts`). Property tests use fast-check with a fixed seed in CI. Golden fixtures live in `fixtures/golden/`.
- Write commit messages in the imperative, one milestone step per commit where practical. Don't put model names in commits, code or docs.
