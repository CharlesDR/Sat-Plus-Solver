# Sat-Plus-Solver

A client-side production planner for the Satisfactory Plus (SF+) mod. It has two layers: a world of linked factories, and an LP/MILP solver inside each factory.

**Use it:** <https://charlesdr.github.io/Sat-Plus-Solver/>. Everything runs in your browser; nothing is uploaded.

## Using the planner

1. **World view (home).** Add factories, draw links between them on the canvas (drag from one factory's right handle to another's left handle), and group them. The panels below the canvas show the item ledger, factories, links, power, the node pool and groups. "Trace item" highlights everything that touches one item.
2. **Factory view.** Open a factory to set its targets, recipes (alternates are off until you turn them on), unassigned imports, resource limits and objectives. The plan shows as a flowchart of recipe groups and as a table.
3. **Diagnostics.** When a plan can't be made, the factory view says why and offers one-click fixes: turn on the recipe that makes a missing item, import what is short, or raise a node cap. The world view lists failed factories, short links and over-allocated nodes, each with a button that takes you to the fix.
4. **Saving and sharing.** The world autosaves in your browser after every edit. The "Save and share" panel keeps up to 10 named slots, exports and imports `.json` files, and makes share links for worlds that fit in a URL.

### Sample world

[`examples/world.json`](examples/world.json) is a small save: an Iron Works that feeds a Frame Factory over a pulled Iron Plate link and a fixed Iron Rod link (both in the "Starter Base" group), a Steel Mill, and a 300 MW Coal Power plant.

- **[Open the sample world](https://charlesdr.github.io/Sat-Plus-Solver/#w=N4IgtgpgLghiBcoBuCAsAaEATGsASMAzgBYIggC+mAZjAMZQD2ATgJYSEIDaorWZrZowB2AWgDuLANadMwmJDIBJIcIAEAdWmyQAcyEBXAA5L+8EIVjMoEZiEzMIARwMcoCUFd3RO8LgF0qEAN5QkJWXWEILCUwIxYoXwDMIzYWVigATwQABjlGG18QAFkYKQ41KGIINSMAG1wKqprqZgUW+iZmTNqDOrrCADp7EEdCRgNmOg4PCipeMxBW9p15RXMAMTbINQ3OlmzMfQmTRcsYa1sRxxc3DxAvH25eGzAyMEYsPovRZcUHRoIACsFECmBCRHCkWisXi1iS-hSaTYWVy+UKZGuHAmUxmiDm6AWZEsEAgdVEYFY-RGawgZAAyjYyWpilS6ljbpZ7o9Es8QBkIG9zCSyaIAEYQBTXQHwACMOVBQQhYQiURicQSCKRrHSqPgeRAwgKePIDmxk2mvmABKJ5jojBg5Pi4iucnaZAAwg66moAAqMF12I6GU5kZ2u0bOVxcxAPC7eXl+F6C97iaU2BAAZhyCsRkborCMeNAjvYYnDzFEMAMukgwhsdngtAGEEwYp1YEh4smUUbzcIrZAdAuYpEomdWFsontjtE3l7uBYCH7g5n5LXc4gC66y8dA5orDo42ErAMYF+rnJQiwomEBjodUllYr44a9d3LZol4vovntkXfZ7oOOongAXtEP7ktQ35-m0O5NkBmCPjASAcOKHZdmKPZXAhn4gHUrAuHw6GMNBopkeSsEAR++7gJk0wETAJGdmE3bML2NGDneD5PqI1SNJWYBSKIsriowVJTtQh7Hqe54UaI16cXI97IZW-ENhSwmiaOEmVlJR4iLJkEKZ8oiEAR6wrspPE-OpU5CSJYm6a+BhMCeZ7GYpuG0dxql8ZKGkOdp4mPs+dSuYZHnydeZkWXS3lcSpvF2YJWlOaFoiTDA7lyd+XlWYaSW2QF9lpTpGVZTlnmmeZrCWYhhU2WpJWpaIABM6WSdJkW5aK+UNb5yUtZp7WdXp3VVdFNVxUpjV+SlI0deVU71BFk15Z8s2DcVAmLWNLluUZU03rV9V4dtzW7Q5S0hVOlVHRtZgFRd-lXcJN3OfdUWPbFdXxQVRZQEIj4efa5TTt6m7bkuCUpOFh3fX1pkvS+9TZe4sOjIwdDlFAxnyVR8EFeMBE3u2pHfuTLGEGxHGYyTxFU12C1BcxkKzQzZMYaxLNldzNOnf9DWc2zPPDaz9pxJ0ou+MTjCkzLr2BWlktGNLTOsYLHPy4z-NK6Vjm0GKbB0NrCsazTvOGzAxuHr9Z20SLFv661onIahsvCzrXOMNTLsjW7koe-bQt4U7etW6JYD0WSrBwPT3uK5HFIx4xIdm7rvvM+LaVqzjMDeDeBFET7FEAH5tQAnLKsp0JXGc+37yd51IBcQcXBiZ+XEqoAA7NQoeO4nzvJ+HFNkg3Sc545Y-yVrCfmxH0+iZIm0L5nTfLxIjDTX9k8j9PS38-vS9vaNzvz3Li9Z2LZ8dar6vH+vjfZ3fENSwwiuX171+b2-RsmxPjfS2h9fg2xNunZ+U837uzxFfDer9lajVgQLGaUCD5v2jgxOOQC-5II6lg2OTFv5h2HqffB456Ct0LqIDuXdLxl1lL3GA8pTboPIQbDqLc25F0Ip3UuDCYDRDFL3AAHLgxBnCzJkPHuydhwD-bXWkdfOeaD4Ev1vhQ1eT0f4IM0VI7RkD1HGWTsOZgo5ywBknIBUhCt5KmJHGOCcU4SFDzsd+UxkNXGDhFvYregNgYQFBowcok8-Fn1EgE+WQTzxgwgEY3RN5wlINEoQPo0FnxWJwsY5JBtUnpMmOOLJlZvGYF8R40BZiLFFPENYsJFS35VKccUhJtjiK5Navfb09TRRWy6bOUpFhE4dL2lEkGsSQmDx8cMhpFCxkxIhuDQZ5TemgLSXUDJNS6lQJGUo9ZmznElLUT-VyIFFFpWgMQTIj4ohziIGbU5Y5k6XOuVueJugiCtLcY8sQzyAAeBYbA3iMMQAohk6AUlwA2B5UAzn-MBRBEFYKTwQs7FADS5kaxfOmfDOFW8KIwrxRE4yyz5Y-POY5K5WAhDzkJU8reVKaVbmxWUslsL6XEpAqwcCSTLx0t+VvLlPKSXHNseS5OdCBETwXuKrekqSKqL3jK9lAriXyCgFlSi9zlVEpSbeXAmq7moKVVfWVxKhA42gJBflFLRIWtxiKk1JyVW2tEBq8xsibXJ3daORVDscVmooS8m57ztWmpdX00Qwa3lGpZUM3FHKg0AoFMC0Fh1UVQuyc63VUiIDJqBeONN4LIXopceFXQcaSaBqkQSnViaa3flJQm1VFDGWMFpXWltUi23zkrWynNnTRBCogrW8NA69rDt5aKJt1bB3yvJqO7N9a518PodO0V3yI2gPVYaj5nsxVbrfjutoWrjX+tZc2ilHV7VWsXQe8dSib14z9VMi9s69o+s9Z2q9brJi+sbRuwcPrWC3MJiwMyxgpzECQLFLFgzgOgbeXBcDaSixqRgySKUmMEPxNZtBqG-4uhxpwwHCkMGwNHKdXhEjrMwDkaQwBMyNgsMFRo+9Pi9HoaUfPQ8P9IHcPsfwxRpjkohSsb47cpRdGCPIe46+3j5j+N7Wk8JzDYmGqfvkgTBjRMGpfV6leZGRVMmBlfOjWahjnZYXYlmlsBJgihChGqWEmpuB5lSDqFE2R9TohNF6R0agUqEDUNlLAag1OVAkxUEQdRMjDDNOMC0xY5h5mOMYJItoLBWGhW6dYIBGQXAbGoAAQkQOkmB7T9BgEYAcOi7OEn5IsCsNJ3TmH9IGEYlWGg1eiJxUESEQMyD5HwMMDQMQ0CEEKfkqht7MCG5gJgZA-gzEwAKKbggnFjfK+AT48VQBSBA01vo7IghA2yoQOEGN9uHbIBKOo7gFvsEbLKG0jWyDXh0K0X2AgZuSDmzoRb5hls6DWz9scilMAfEnPcA7whFhST+b1gEGY5QKgW20YQF2Egw5u+YO7D2HhPYQC9-r2AIC0D6ImUAjAxQACsIAMFYB7bgkZEu4k4HmJgoVsrTFyIMHMORZSYEdA2dVcCGriFBY+UodBiD8f3bRe0lgXPwlmo4AsRYrRBE7H8gAKkT+Ad5+hBCNJOf08tZgUCAA)** in the planner, or
- download the file and use **Save and share → Import world file**, or
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
