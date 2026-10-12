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

- **[Open the sample world](https://charlesdr.github.io/Sat-Plus-Solver/#w=N4IgtgpgLghiBcoBuCCMAWANCAJjWAEjAM4AWCIIAvtgGYwDGUA9gE4CWExCA2qOzgrtWzAHYBaAO5sA1t2yiYkCgEkRogAQB1WfJABzEQFcADisHwQxWKygRWIbKwgBHI1ygJQN-dG7weAF0aECNFYmJ2fVEIHBUwEzYofyDsEw42digATwQABgVmO38QAFkYGS4NKFIIDRMAG3wqmrraViU2xhZWbPqjBobiADpHEGdiZiNWBi4vEKhJCAqU4Mx+CxB2zr1FZUsAMQ7IDQPutlzsQymzTesYW3sx5zcPLxAfP15+OzAKMGYOAGD3E22UTmaCAArFQ1qFwpForF4olbKs0hkODl8oVihRnlwpjM5ogFksVrw1hsKNYIBAGuIwOxBmM9hAKABlOz0jSlZkNAmvazvT7Jb4gLIQP6WWn08QAI2WfwhdjQeVhITCJERMTiCSS6JA6XYmWx8AKIFERRJlCchOms38wDJyzklJo1MsDGYMAZiSWDgUnQoAGEfQ0NAAFZgBsbXUzmCj+p52oWeRAfB6+MUBH5S-6SZ6Q+CoKEAJgA7MN0AAOGsV2F2hjsEwk0C+zgSZOscQwIz6SCiOwOeD0IYQbDyk1gbUK6YxEdj4gTkAMB7ysTif04ezib2+8S+Bf4NgIJcr-cMy+HiDHnpn33LujsBiTUTsIxgUHuBkiHDiUQjAYBplh7bstyaIcH3HOgf2-OUj3sE9F0fFcTXfAAvWJ4IZWg4MQjp71HVDsBAmAkC4BVp1neV5yeYiYJABp2DcAQqOYPC5U4hkCOQ6Cn3AbJZmYmB2JnCI51YBd+JXQDgNA8RamaHswBkcRUAVZhmV3WgXzfD8v248Q-xkhQgLInslOHRk1I0jdtJ7XTXzEAycOMwFxGIZj9nPMz5JBKzd1U9TNIciCjBYd9PzckyGIEuSLMU5ZrOCuytJAsCGgilzoqMv9PO89k4tk8yFMClTbNCjLxGmGAosMuDYt8y1SoC5Kgsq+zqtq+qYo8rz2B8kiWv8yz2oq8QyyqnS9Jyhq5Sa4aErK8abMm6bHNm3q8v6wrTJGxLyrWqaut3Rpsu2xrAX25a2uU46NvCyLXJ2-8BqGxjbrG+7gpO9Ldx6l6rosZqvqSn61L+sLAdy4GCsGormtbKARBA6LvUqPdwxvO9T2KtIsue2GFo8sHwMaOr02akQGEqKA3KM3iiOayZmP-KcOLgjnxOISTpPxqxmDZsTZyO1KRYifbWbY7nRdW8XZYk97EeG6X2eoiSxcq70Em6CX-BZoWZY13mtZCnWTD1xXeeVqWjfV5gefBlLKvoeUOAYO3het52OpCt2Pfhj6BLV-XfYmjSyIog3VftsOzcj5Zo6DlXGNDn2E8ZIT6XYOABfTk3w7WjSwGzkSU6943HbliGQst2mYF8f9mNYh3uIAPzLABOVBUAYLvK4dp3M-rmRG+wlujCrjvFXQCtaFTkO44z+XKoLzn6UH+PV5C9ejNt-Pl8LzPpGuw-vePneNNPt69vPqvh53k6Ta3lfa+f6ulbvw2L8-02n6xrrJg+tX6X3foA+u9MfYHx-g-GuLt1oBxfKAv+RdfqghgO7F8Fd75D3gX7KaUcSSwLwZrABRCbbf1jr-R+4DS7CVzig2hCCpr0JzqJGB1C4FkPAaPcezcWJTzbj+duqAKwwFQHkT2uDt68MYGPJu4hJ7TxETAWI8oKw1iYfgiaU094-m0Twlhnkj4bwZJwtOpjmEEKkMwM+JDZHGJvjghxRlM5rlYBuLsMYdwoUscLNxV89zrk3NuXcFil4BLgu47GESVyh0CbXDSyNUYQHRswSoW9EkIOSdAVJ6TMZxOwAk6JQTiADDwmBHx9FXGlKSZ5Cp0wtzVJ7EUwWUS5Rmymh4rxzTJC+KyXU4xPTQktJcVw-82SbGXkGZ0gB142klLmbwvJQs0lfgxoveJccpm6K3KstGGyMkQHGf4tiuyHrlIaJUvpAyZEXPQVcm5YTWlUP8RFdCaDKrQFINkECMRDwkC9h8zcmcfl-NvCc-QJBTmRJBRIMFAAPZsdh-wmFIEUFyDBGT4GHMCqAnykUouwuizF75sUzigNZLy-ZYXbMJoSoJ3F8WMvqfvN5cKCWgqCb8nAIgjwsu5fU3l-Lbx0uKULeFXyQroXYFhSZBjz5SszrK+VblFmSq5QioJyjhGbyVVq6VkdBEqLlBqhlQqckAXwLVHiQKDWsqtYoKAtrAWUIRoK7V9SaZ0xwp6o17labQHVRy+lyqgkus8WY-1mdI0bnZR6h1lqbHgv+VC+1P9w3gNTZCt14r2lZuMRAZFko0UYuehS3FNTqGFpTSW1FW5y1YpxVS8JWV9D5tZrWvZzKk1euMQm4OYbDVdMUtkPlzABV9ulVNEVk6xXmu7Q9VV2Fe2ZpHQAldCqzWholRa-tNjdXsTXTWjd4Cj0c0HVsvdS70HOtddCmO7yz3GPvR0O17qh03pfTYn1waT3Psdb+5gQb6ZXpjQAuN0bp2jqg+BgWcb2AAqZmwBprZLJIAKrStpiHkOQsIqh8p6HFKYdpEofauGTni1IJhlDrzE3NUo8XRktH8PIXzUx8WYBWO41aXYcjCHphTgBegmjOMkI9A40JpDVHIYkfEwRvjSoKPSZE3J7jCn2M4dU7J9aGm6OeX49KRjQmzFuTo-tGG81fyk1alUgMEFKb7WcT7WiUlq3jioJqBEURdQogNJSDEJosS5HNLiG0YZfQaHKsQDQdUcAaDI2AaoOnYtiAaNkUYdpJgOjbC6CkARgiBCuMYEwKRPRWBsHioM+wQBcgeMODQAAhEg7JsDekGDAMrsQZIeglJsbsrJgyWGjLGdrQsmjdZBqhRsTEkNulzP1pMTQ8R0BENKCU6hbGsDdNgFgFAwRzGwJKDbwhQkrba+AQERVQAyCQwNgYAoFgdFEMQVE6Zbv3YoIqBong9ucBHKgLz6wluWD-HodojshBbekDtvQ+3LCHb0Cd6Hm4TLYABDud4d3RCbF0oinrKoiqSOe3VN7SRsdfcsD9v7HwAdoC88V3AEB6ADBzKAZg8oABWEAmDsGjrwKwHiUW5CZywDKdVZj5GGHkWXqBsC+mHM64hw1JAYpAuUBgpAZNPoEt6aw-m0T7WcM2VsToQgzkRQAFXp-AQCgwFdIC0jgA4WUBBNeyOkQEQEcwo3cMUwajQXxZFC37iAIQrQ7mjELeYVAgA)** in the planner, or
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
