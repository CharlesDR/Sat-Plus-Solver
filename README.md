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

[`examples/world.json`](examples/world.json) is a small save: an Iron Works that feeds a Frame Factory over a pulled Iron Plate link and a fixed Iron Rod link (both in the "Starter Base" group), a Steel Mill, and a 300 MW Coal Power plant.

- **[Open the sample world](https://charlesdr.github.io/Sat-Plus-Solver/#w=N4IgtgpgLghiBcoBuCCMAWANCAJjWAEjAM4AWCIIAvtgGYwDGUA9gE4CWExCA2qOzgrtWzAHYBaAO5sA1t2yiYkCgEkRogAQB1WfJABzEQFcADisHwQxWKygRWIbKwgBHI1ygJQN-dG7weAF0aECNFYmJ2fVEIHBUwEzYofyDsEw42digATwQABgVmO38QAFkYGS4NKFIIDRMAG3wqmrraViU2xhZWbPqjBobiADpHEGdiZiNWBi4vEKhJCAqU4Mx+CxB2zr1FZUsAMQ7IDQPutlzsQymzTesYW3sx5zcPLxAfP15+OzAKMGYOAGD3E22UTmaCAArFQ1qFwpForF4olbKs0hkODl8oVihRnlwpjM5ogFksVrw1hsKNYIBAGuIwOxBmM9hAKABlOz0jSlZkNAmvazvT7Jb4gLIQP6WWn08QAI2WfwhdjQeVhITCJERMTiCSS6JA6XYmWx8AKIFERRJlCchOms38wDJyzklJo1MsDGYMAZiSWDgUnQoAGEfQ0NAAFZgBsbXUzmCj+p52oWeRAfB6+MUBH5S-6SZ6Q+AAZjy6sCdoY7BMJNAvs4EmTrHEMCM+kgojsDng9CGEGw8pNYG1CumMR7feIA5ADAe8rE4n9OHs4m9vvEvgn+DYCCnM-XDMPm4g256e9907o7AYk1E7CMYFB7gZIhw4lERgYDWWLebS6aLsL37OgX2fOUt3sHdJ0vGcTXvAAvWJwIZWgwMgjpz17WDsB-GAkC4BVh1HeVxyebCQJABp2DcAQiOYNC5UYhkMOg4Cr3AbJZmomB6JHCIx1YCd2JnT9v1-cRamaFswBkcRUAVZhmVXWgbzvB8n2Y8Q3xEhQvzwlspO7Rk5IUhdlJbVTbzEDSUO0wFxGIaj9n3PTxJBIzV1k+TFIsgCjBYe9HzsnSKI4sSDMk5ZjO8sylJ-P8GgCmzgq0t9HOc9kwtE-SJM8mTTN8hLxGmGAgs0sDQtcy1co86KvMK8zitK8qQocpz2BcnCavcwz6oK8QACYipUtSUoquUqu6iK8v6kyhpGyyxtatL2sy3Sesi-L5uGprV0aZKVsqwENpmurpJ2xb-MC2zVvfDqusos6+ou7zdvi1cWtu46LGq56oteuT3r8r7Up+jLOqy6raygEQf2C71KjXcMTzPXdsrSJKbrByaHP+-9GjK9NqpEBhKigOytNYrDqsmaj3yHBiwMZ-jiEE4SMasZh6b40dtti3mIg2um6JZvm5oFsWBIeqHupFhniIE-nCu9BJukF-xae50XFbZ5WfNVkx1altmZeF7WFeYVmAZiwr6HlDgGHNnmTZthqfPtx2Icejj5Y1t2BoUvCCM1uWLf9-Wg+WEPvdlyi-ddyPGS4+l2DgTmE91gP5oUsAU542PnZ1q3xcBnyjbJmBfHfajaMt5iAD9BoATlQVAGGbovLetpOK5kKvkNroxi8bxV0AAdloOPffDxOJcKzOmfpLuI-nnzF60s2M9nrOk+kE7t5d3e14U-f7vWw-i57tfdt1le57L2+S+li+taP5+9Zv5G1aYDX7+Px+38K4U1dlvN+V9S62wWp7G8-8P7ZzeqCGADsbyF0vt3SB7thrBxJOAjBSsv44NNq-MO79r6ALztxNOcDyFQOGpQ1OvEwGkIgQQwBfcB41xosPeuL4G6oHHjAVAeQnboNXuwxg-dq7iCHiPPhMBYjynHgADhoZggaw0N4vjUWwuhjkd5LwZMw+OBjaFYKkMwA+eDxF6LPmg6xWkk5zlYAuJsMYVwwRMTzRxJ81zzkXMuVcxiZ7eLAk4lGwSZx+x8WXBSMM4YQARswSoK8YlQLidABJSSkaROwNEsJvjiADDQn+dx5EHEFNiY5Yp0wlxlJbLkrmoS5T62Gs41xdTJAeNSZUvR7SAn1PsSw98aTzGHh6S0r+x5Gn5MmewzJ3NElPkRtPKJ4dRkaKXAs+GyzkkQCGV4uiGzLpFIaCUzp3SxHHMQac85gSGkkK8QFeCCDCrQFINkH8MRNwkGds8xcSd3mfNPPs-QJADkhP+RIQFAAPasdh3wmFIEUGyDBGT4G7H8qALzYXwuQkilF940UjigMZJy7YIVrKxji3xzEsU0qqZvR5kLsUAt8R8nAIgtz0rZVUjlXLTyUrydzKFryfLwXYEhEZ2jD6iqThKqVdkZkitZdC3xsjeHL1laqsVQduFyLlMq6lvL0kfnwKVFivztUMtNYoKAFqfnEMhjytVVTSbkxQi63V9kybQCVcyqlcrfH2pcYYr1ScQ0LiZc661JrzFAq+aCq1b8g2AITSCx1Qqmmpr0RAOFkpEXIpusSjF5TSE5vjfmhFS4i2ovRaSoJSV9BZrphWzZdLY2ur0dGn2gadWtMktkTlzBuWdrFcNflI7BVGrbZdBVyEO0pv7V-ed0rDUBuFcart5iNX0UXeW5dgDd2Mx7aszds7EF2odWC0OTzD16KvR0S1Tre3nvveY91fr913ptR+5gvqKanvDV-SNYax0DtA0Bzmkb2DfOpmwaptZDJIAyhSxpMG4MgswghopSHJIodpEoDaGH9kC1ICh+DDyY3VRIznRkFGsPQSzbRgWYAGNowaXYIj0HphDm+Yg8jqMoI9GY7x2DpGgb4aE9hzjSpiNif45Jtj0mmPoYUxJhaynKOOS49KGjvHDF2UoxtUGE1Xx41qqUgMAEiYbTsa7UiQky39ioJqBEURdQogNJSDEJosS5HNLiG0YZfQaHysQDQZUcAaEI2Aao6mItiAaNkUYdpJgOjrC6CkARgiVgMMYEwKRPRWBsJioM+wQBcgeN2DQAAhEg7JsDekGDAQrsQRIeglJsZsrJgyWGjLGJr3Mmhtd+rBWEuFYNulzF1pMTQ8R0BENKCU6gLGsDdNgFgFAwRzGwJKZbwgAnzca+AQEWVQAyFg91gYAoFgdFEMQVE6YLtXYoIqBonhNucB7KgVz6xZuWDfHodoVshCrekOtvQW3LA7b0PtsHi4dLYABCud4l3RCbFUjC9rKosrCLu2VR7SQ0evcsO9z7HxvtoFc3llc9ABg5lAMweUAArCATB2Ah14FYZx8Lch5ZYAlMqsx8jDHLHkVA2BfTdjtbg7qkhkU-nKAwUg4nb0cW9NYLzaINrOGrLWJ0IQRwwoACpU-gJ+QYUukBKRwAcJKAhavZHSICL8OZYbuDyZ1RoN4sgBY9xAEIVoVzRm5vMKgQA)** in the planner, or
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
