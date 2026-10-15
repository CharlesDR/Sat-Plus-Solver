# Sat-Plus-Solver — Plan

Every milestone is merged on its own and leaves `main` green: lint, typecheck, test and build all pass. References like §4.3 point into `ARCHITECTURE.md`.

## Shipped

M0–M10 (v1), M12–M17 and the graph readability track G1–G5 are all built and merged. Their scope and acceptance criteria are kept in [`archive/PLAN.md`](archive/PLAN.md), and the design decisions they made are A# rows in ARCHITECTURE §10. Later batches (S1, S2, F1, F2, UX-A to UX-D, ST, D1, the W and D batches and the todo slates) were planned in the project's build plans and are recorded in §10 as A73 onwards.

## Open: M11 backlog

- **Joint world optimization** (§4.6): opt-in, enforces map node limits exactly.
- SF+ golden cases. Booster power value (R1). In-game checks of A3, A4 and A6.
- Multiple power grids (A8). Transport calculators: trains, trucks, drones, Dimensional Depot (link transport UI is hidden behind `SHOW_TRANSPORT` in `apps/web/src/flags.ts`). Overclock and Somersloop settings per machine group.

New work is agreed with Charles first and listed in the project's `todo.md` before it is built; each batch adds its A# row to §10 and, when it changes the `World` shape, bumps `World.v` with a migration and a test.
