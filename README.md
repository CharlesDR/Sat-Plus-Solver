# Sat-Plus-Solver

A client-side production planner for the Satisfactory Plus (SF+) mod. It has two layers: a world of linked factories, and an LP/MILP solver inside each factory.

**Use it:** <https://charlesdr.github.io/Sat-Plus-Solver/>. Everything runs in your browser; nothing is uploaded. For one factory on its own, try [simple mode](https://charlesdr.github.io/Sat-Plus-Solver/simple/), which keeps its own saves.

## Using the planner

1. **World view (home).** Add factories, draw links between them on the canvas (drag from one factory's right handle to another's left handle), and group them. The panels below the canvas show the item ledger, factories, links, power, the node pool and groups. "Trace item" highlights everything that touches one item.
2. **Factory view.** Open a factory to set its targets, recipes (alternates are off until you turn them on), unassigned imports, resource limits and objectives. The plan shows as a flowchart of recipe groups and as a table.
3. **Diagnostics.** When a plan can't be made, the factory view says why and offers one-click fixes: turn on the recipe that makes a missing item, import what is short, or raise a node cap. The world view lists failed factories, short links and over-allocated nodes, each with a button that takes you to the fix.
4. **Saving and sharing.** The world autosaves in your browser after every edit. The **File** menu in the top bar keeps up to 10 named slots, exports and imports `.json` files, and makes share links for worlds that fit in a URL.
5. **Getting around.** Press **Ctrl+K** (Cmd+K on a Mac) to jump to a factory or add a target by name. The top bar also switches between light, dark and your system theme, and the factory settings sidebar can be hidden to give the flowchart the whole width.

### Sample world

[`examples/world.json`](examples/world.json) is a small save: an Iron Works that feeds a Frame Factory over a pulled Iron Plate link and a fixed Iron Rod link (both in the "Starter Base" group), a Steel Mill, and a Coal Power plant sized so world power nets to 0 MW.

- **[Open the sample world](https://charlesdr.github.io/Sat-Plus-Solver/#w=N4IgtgpgLghiBcoBuCCMA2ANCAJjWAEjAM4AWCIIAvtgGYwDGUA9gE4CWExCA2qOzgrtWzAHYBaAO5sA1t2yiYkCgEkRogAQB1WfJABzEQFcADisHwQxWKygRWIbKwgBHI1ygJQN-dG7weAF0aECNFYmJ2fVEIHBUwEzYofyDsEw42digATwQABgVmO38QAFkYGS4NKFIIDRMAG3wqmrraViU2xhZWbPqjBobiADpHEGdiZiNWBi4vEKhJCAqU4Mx+CxB2zr1FZUsAMQ7IDQPutlzsQymzTesYW3sx5zcPLxAfP15+OzAKMGYOAGD3E22UTmaCAArFQ1qFwpForF4olbKs0hkODl8oVihRnlwpjM5ogFksVrw1hsKNYIBAGuIwOxBmM9hAKABlOz0jSlZkNAmvazvT7Jb4gLIQP6WWn08QAI2WfwhdgQABY8rCQmESIiYnEEkl0SB0uxMtj4AUQKIiiTKE5CdNZv5gGTlnJKTRqZYGMwYAzEksHApOhQAMJ+hoaAAKzCDY2upnMFEDTwdQs8iA+D18YoCPyl-0kz0h8FQAA5y8MAMwAJgAnGrYQ6GOwTCTQP7OBJU6xxDAjPpIKI7A54PQhhBsPKzWBdQrpjExxPiFOQAwHvKxOJAzh7OJff7xL4l-g2AgV2vDwzr8eIKeehf-au6OwGJNROwjGBQe4GSIcHEUQjAYBplj7XsdyaEcn0nOg-1-OUT3sM9l2fNczU-AAvWJEIZWgEOQjpH3HdDsDAmAkC4BVZ3neVFyeUi4JABp2DcAQaOYAi5W4hkiNQ2CX3AbJZlYmBOLnCIF1YJdBLXYDQPA8RamaPswBkcRUAVZhmX3Wg3w-L8f148QALkhQQIovsVNHRkNK0rddL7fT3zEIy8NMwFxGIVj9kvCzFJBGz93UzTtKcqCjBYT9vw8symKEhSrOU5ZbNChydLAiCGiitzYpMgDvN89kEvkyylOCtT7PCrLxGmGAYuMhD4v861yqC1KQuqxzavqxq4q8nz2D8si2sC6zOqq8RaxqvSDLypq5Ra0akoqya7Om2bnPm-qCsG4rzLG5LKo2maev3Rpct25rAUO1aOtU06tsi6L3L2wChpG5j7omx7QrOzL9z6t6bosVqfpSv6NIBiLgfy0GiuGkrWvbKARDA2LfUqA9IzvB9z1KtIcte+Glq8iHIMaBrM1akQGEqKAPJM-iSNayZWMAmcuIQrnJOIaTZMJqxmA5iT5xO9KxYiQ72Y43nxfWyX5akz7kdG2XOdoqSJeq30Em6KX-DZkW5a1-mdbCvWTAN5X+dVmWTc15g+chtLqvoeUOAYB3Rdt12urCj2vcRr6hI1w3-amrSKKoo31cdiOLej5ZY5DtXmPDv2k8ZET6XYOAhczs3I42rSwFzsS05903nYVqGwut+mYF8QDWPYp3eIAPwbVBUAYetq6dl3s8bmRm9wtujBrrvFTVAB2Wh07DhOs8V6qi+5+lB8Ttewo3kz7cLlfi+z6RbqP32T93rSz4+g6L5r4fd7Os3t9X+uX9rlX7+Ny+v-N5+ON9ZMENm-K+H8gGN0Zn7Q+v9H51zdptIOb4wH-xLv9UEMBPZvirg-IeCCA4zRjiSOB+DtaAOIXbH+8c-5PwgeXUS+dUF0MQTNBhedxKwJofA8hEDR7j1bmxKeHc-yd1QHPGAqA8jezwTvPhjAx4t3EJPaeoiYCxHlHPcszCCFTRmvvP8OjeGsO8sfTeDIuEZzMSwwhUhmDn1IXIkxt9cGOJMtnDcrAtw9jjHuNCVjRbuOvgeTc25dz7kscvQJCEPG40iWucOQT65aVRujCAmNmCVG3kkxBKToBpIydjeJ2BEkxOCcQAYBEIK+MYm4spyTvKVOmDuGpfZinC2iXKC2M1PHeJaZIPx2T6kmN6WE1prjuGARybY68QyumANvO00p8y+H5JFukn8WMl4JITtMvRO41kY02ZkiAEyAkcT2U9CpDQqn9MGbIy5GDrm3PCW06hASoqYXQdVaApBshgRiMeEgPtPnbmzr8-595Tn6BIGcqJoKJDgoAB6tjsIBEwpAihuQYIyfAo4QVQC+ci1FuEMVYs-DiucUBbI+UHHCnZxMiXBN4gSplDSD7vPhYSsFwS-k4BECeVlPKGl8oFfeelJSRYIu+WFTC7AcJTMMRfaV2c5UKo8ksqV3LEXBJUSIreyrtUyujkI1RcpNWMuFbkoC+B6p8WBYatl1rFBQDtUCqhSMhU6oaXTBmeEvXGs8vTaAGrOUMpVcE11XjzEBuzlGrcHLPWOqtbYiFALoUOt-hGiBaaoXuolR07NJiIAoslOizFr1KV4tqTQotqbS1op3BW7FuLqURJyvoAt7M637JZcm71JjE2h3DUa7pylsj8uYIK-tMqZqiqneKi1Panpqtwn2rNo7AGrsVeasNkrLUDtsXqzi67a2bogcermQ7tn7uXRgl1bqYVxw+eekxD6Oj2o9cO29r7bG+pDael9Tq-3MGDYza9sbAHxpjTOsd0GINC3jewQFLM2CNPbNZJARU6XtKQyhqFxE0MVIw8pLDtIlCHTw6cyWpAsOobeUm1qVHS6MjowR1CBbmOSzAGx-GbS7AUcQ9MGcgKMG0bxihHonHhPIeo9DUjEnCP8aVJRmTon5M8cUxx3Dam5ObU0-R7yAnpRMeE+Yjy9HDpw0Wv+cm7VqlBigtTQ6Li-b0RkjWycVBtQIiiPqFERpKQYjNFiXIlpcR2gjP6DQlViAaAajgDQ5GwDVF03FsQDRsijAdJMJ0HY3QUgCMEQIVxjAmBSN6KwNh8Uhn2CALkDxRwaAAEIkHZNgX0gwYDldiHJL0EpNi9lZKGSwsZ4wdZFk0HrYN0LNhYshj0+YBspiaHiOgIhpQSnUHY1gHpsAsAoGCOY2BJSbeEGE1b7XwCAhKqAGQyHBsDAFAsDoohiCokzHdh7FBFQNE8PtzgY5UDefWMtywAE9DtGdkIbb0hdt6AO5YI7ehTsw+3GZbAAI9zvHu6ITY+kkW9ZVCVKRL2GrvaSDj77lhfv-Y+IDtA3mSu4AgPQAYeZQDMHlAAKwgEwdgsdeBWE8ai3IzOWBZQarMfIww8hy9QNgf0o4XUkNGpITFYFygMFILJ59QlfTWAC2iQ6zhWzthdCEOcSKAAqDP4DAUGIrpAOkcAHBygIZr2R0iAhAnmNG7gSnDUaG+LIYX-cQBCDaPcsYRbzCoEAA)** in the planner, or
- download the file and use **File → Import world file**, or
- print it from the command line with `pnpm world solve examples/world.json`.

- Design: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Milestones: [`docs/PLAN.md`](docs/PLAN.md)
- Contributor rules: [`CLAUDE.md`](CLAUDE.md)

## Development

Requires Node 22+ and pnpm 10 (`corepack enable`).

```sh
pnpm install
pnpm dev         # web app (needs pnpm build:data first)
pnpm lint        # ESLint (incl. package dependency rule) + Prettier
pnpm typecheck   # tsc for every workspace
pnpm test        # Vitest
pnpm build       # production build of the web app
pnpm e2e         # Playwright end-to-end suite against the build (run pnpm build first)
pnpm build:data  # data/generated/model.json + report.md
pnpm solve --target "Iron Plate:60" [--import "Iron Ingot:30"] [--objective scarcity]
pnpm world solve examples/world.json [--json]
```

`pnpm solve` prints one factory's plan (recipes, machines, imports, byproducts, nodes, power). Run it without arguments for every option. The web app shows the same table: pick a target item and rate, and it solves in a Web Worker. `pnpm world solve` resolves a saved world (factories, links, groups) and prints its factory, link, item-ledger, power and node tables.

In a sandbox with a preinstalled Chromium, point Playwright at it with `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome pnpm e2e`.

| Workspace         | Role                                                  |
| ----------------- | ----------------------------------------------------- |
| `packages/data`   | Build-time pipeline: raw SF+ JSON → `model.json`      |
| `packages/solver` | Factory layer: LP/MILP model, objectives, diagnostics |
| `packages/world`  | World layer: factories, groups, links, ledgers        |
| `packages/graph`  | Flowchart / world graph construction and layout       |
| `apps/web`        | React UI                                              |

## Deployment

CI deploys `main` to GitHub Pages: after lint, typecheck, tests, the build and the end-to-end suite pass on a push to `main`, the `deploy` job publishes `apps/web/dist`. The build uses relative asset paths, so it works under the `/Sat-Plus-Solver/` project path. Pages must be set to deploy from GitHub Actions once (repository Settings → Pages → Source: GitHub Actions).

The end-to-end suite (`apps/web/e2e`) covers the full journey (world → link → drill-down → recipe toggle → back → export → import → reload), the diagnostics fixes, saves and sharing, the flowchart, and an accessibility pass (axe, WCAG 2.1 A/AA, light and dark, plus keyboard use). Every test fails on any console error.

## Icons

The item and machine icons in `apps/web/public/icons` come from Satisfactory Modeler and are game art (Satisfactory, Satisfactory Plus). They are **not** covered by this repository's MIT licence; see [`apps/web/public/icons/NOTICE.md`](apps/web/public/icons/NOTICE.md). `python3 tooling/import-icons.py <modeler>/images/icons` regenerates them after `pnpm build:data`.
