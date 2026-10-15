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

- **[Open the sample world](https://charlesdr.github.io/Sat-Plus-Solver/#w=N4IgtgpgLghiBcoBuCCMA2ANCAJjWAEjAM4AWCIIAvtgGYwDGUA9gE4CWExCA2qOzgrtWzAHYBaAO5sA1t2yiYkCgEkRogAQB1WfJABzEQFcADisHwQxWKygRWIbKwgBHI1ygJQN-dG7weAF0aECNFYmJ2fVEIHBUwEzYofyDsEw42digATwQABgVmO38QAFkYGS4NKFIIDRMAG3wqmrraViU2xhZWbPqjBobiADpHEGdiZiNWBi4vEKhJCAqU4Mx+CxB2zr1FZUsAMQ7IDQPutlzsQymzTesYW3sx5zcPLxAfP15+OzAKMGYOAGD3E22UTmaCAArFQ1qFwpForF4olbKs0hkODl8oVihRnlwpjM5ogFksVrw1hsKNYIBAGuIwOxBmM9hAKABlOz0jSlZkNAmvazvT7Jb4gLIQP6WWn08QAI2WfwhdjQeVhITCJERMTiCSS6JA6XYmWx8AKIFERRJlCchOms38wDJyzklJo1MsDGYMAZiSWDgUnQoAGEfQ0NAAFZgBsbXUzmCj+p52oWeRAfB6+MUBH5S-6SZ6Q+CoKEAJgA7MMACwADlrFdhdoY7BMJNAvs4EmTrHEMCM+kgojsDng9CGEGw8pNYG1CumMVH4+Ik5ADAe8rE4n9OHs4m9vvEvkX+DYCGXq4PDKvR4gJ56599K7o7AYk1E7CMYFB7gZIhw4iiEYDANMsvY9tuTTDo+E50L+P5yse9inkuT6riaH4AF6xAhDK0PBSEdA+Y5odgoEwEgXAKjOc7yguTwkbBIANOwbgCNRzD4XKXEMoRKEwc+4DZLMLEwBxs4RPOrCLgJq5ASBYHiLUzS9mAMjiKgCrMMye60K+76ft+PHiP+skKMB5G9spI6MupmmbjpvZ6W+YiGbhJmAuIxAsfsF7mQpILWXuakaVpjmQUYLAfl+7mmYxgnyZZSnLDZIX2dpoHgQ0kWuTFxn-l5PnsvFckWYpQWqXZYWZeI0wwNFRnwXFfmWmVgUpcFVUOTVdUNbFnneewvmka1AVWR1lXiGW1W6fpuWNXKzUjYl5UTbZU0zU5c19flA1FWZo1JRV63Td1e6NDlO1NYCB0re1KknZtEVRW5u0AYNw1MXd40PSFp0ZXuvWvddFgtd9yW-ep-3hUDeUg4VQ3FS1bZQCIoExd6lT7uGt73meJVpNlL1w4tnngxBjT1emLUiAwlRQO5xl8cRLWTCxAHTpx8GcxJxBSTJBNWMw7PiXOx1paLEQHWz7E82La0S3LkkfUjI0yxzNGSeLVXegk3SS-4rPC7Lmt89roW6yY+tK3zKvS8bGvMLzEOpVV9DyhwDD2yLNsu51oXu57COfYJ6sG37k2aeRlGG2rDvh+bUfLDHweq0xYe+4njLCfS7BwILGemxH62aWAOeian3sm078uQ6FVt0zAvgASxbGOzxAB+ZYAJyoKgDDd1XjvO1nDcyE3OGt0Y1ed4q1YVrQaeh-HmcK1Vhdc-SQ8J2voUb8ZdsFyvRdZ9IN1Hz7J+75pZ-vftF-VyPu+nab2+r3XL818r99G5fX9m8-bGesmAGzflfD+QCG4M19ofX+j9a6uw2oHV8YD-7Fz+qCGAHtXyVwfsPBB-tprRxJHA-BWtAHENtj-OOf8n4QLLiJPOqC6GIOmgw3OYlYE0PgeQiBY8J4t1YtPduv4O6oArDAVAeQvZ4J3nwxg49m7iCnjPURMBYjygrLWZhBDJrTX3r+HRvDWFeWPpvBkXD05mJYYQqQzBz6kLkSY2+uDHHGSzuuVgm5uwxl3KhKxIt3HX33BuLcO49yWOXoE+CHicaRNXGHIJddNIozRhADGzBKjbySYglJ0A0kZKxvE7AiSYnBOIAMfC4FfEMTcWU5JXlKnTG3DU3sxShbRLlObaanjvEtMkH47J9STG9LCa01x3CAI5NsVeIZXTAE3naaU+ZfD8nC3Sd+TGS8Enx2mXo7caz0abMyRACZAT2J7MehUhoVT+mDNkZcjB1zbnhLadQgJkUMLoKqtAUg2RQIxCPCQb2nytxZ1+f8u8pz9AkDOVE0FEhwUAA8Wx2AAiYUgRRXIMEZPgEcIKoBfORainCGKsUfhxbOKANlvIDjhTsomRLgk8QJUyhpB93nwsJWC4JfycAiGPKynlDS+UCrvPSkpwsEXfNChhdg2EpmGIvtKrOcqFXuSWVK7liLgkqJEVvZV2qZVRyEaouUmrGXCtyYBfAdVeLAsNWy61igoB2qBVQxGQqdUNNpvTXCXrjUeTptADVnKGUquCa6rx5iA1ZyjZuDlnrHVWtsRCgF0KHW-wjRAtNUL3USo6dmkxEAUWSnRZil6lK8W1JoUW1Npa0Xbgrdi3F1KInZX0AWtmdb9ksuTd6kxiaQ7hqNd0pS2R+XMEFf2mV01RVTvFRantj01U4T7Vm0dgDV2KvNWGyVlqB22L1RxddtbN0QOPZzId2z93LowS6t1MLY4fPPSYh9HR7UeuHbe19tjfUhtPS+p1f7mDBoZte2NgD40xpnWO6DEHBbxvYIC5mbBGltiskgQqdL2lIZQ1CoiaGKkYaUlh2kSgDp4dORLUgWHUNvKTS1KjJdGR0YIyhAtzGJZgDY3jNpdgKOIemNOQFGDaO42Qj0TjwnkPUahqRiThH+NKkozJ0T8meOKY47htTcmNqafo15AT0omPCfMe5ejB1YYLT-GTNq1SAyQSpgdFxvs6LSRrROKgmoERRF1CiA0lIMQmixLkc0uIbRhl9BoCqxAND1RwBocjYBqi6bi2IBo2RRh2kmA6dsLoKQBGCIEK4xgTApE9FYGw+Kgz7BAFyB4I4NAACESDsmwN6QYMByuxFkh6CUmweysmDJYaMsYOvCyaD10GaEmzMWQ26XMA2kxNDxHQEQ0oJTqDsawN02AWAUDBHMbAkpNvCDCat9r4BATFVADIZDg2BgCgWB0UQxBUTpjuw9igioGieH25wUcqBvPrGW5Yf8eh2hOyENt6Qu29AHcsEdvQp2YdblMtgAEu53j3dEJsPSSLesqmKlIl79V3tJBx99ywv3-sfEB2gbzJXcAQHoAMHMoBmDygAFYQCYOwGOvArCeNRbkZnLBMr1VmPkYYeQ5eoGwL6EcLqSEjUkJi0C5QGCkFk8+wS3prABbRAdZwLY2xOhCLOJFAAVBn8AgKDEV0gbSOADjZQEM17I6RATARzKjdwJShqNFfFkML-uIAhCtLuaMwt5hUCAA)** in the planner, or
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
