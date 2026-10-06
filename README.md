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

- **[Open the sample world](https://charlesdr.github.io/Sat-Plus-Solver/#w=N4IgtgpgLghiBcoBuCBsAaEATGsASMAzgBYIggC+mAZjAMZQD2ATgJYSEIDaorWZrZowB2AWgDuLANadMwmJDIBJIcIAEAdWmyQAcyEBXAA5L+8EIVjMoEZiEzMIARwMcoCUFd3RO8LgF0qEAN5QkJWXWEILCUwIxYoXwDMIzYWVigATwQABjlGG18QAFkYKQ41KGIINSMAG1wKqprqZgUW+iZmTNqDOrrCADp7EEdCRgNmOg4PIKhxCDKkwPReMxBW9p15RXMAMTbINT3OlmzMfQmTdcsYa1sRxxc3DxAvH25eGzAyMEYsPp3USbRQORoIACsFBWwVC4Ui0Vi8WsyxSaTYWVy+UKZEeHAmUxmiDmCyW3BWazIlggEDqojArH6Ix2EDIAGUbLS1MVGXU8c9LK93olPiAMhAfuZqbTRAAjRY-ME2BAARhy0KCISI8KiMTiCVRIFSrHSmPgeRAwgKRPIDnxk2mvmAJMWMnJVEp5jojBgdPiCzscnaZAAwj66moAAqMAMjS7GUxkf0PO0C9yIN53bwivxfCW-cSPcHwADMOXV-jtdFYRiJoF97DEyeYohgBl0kGENjs8FoAwgmFlJrA2rlkyiPb7hAHIDod1lIlE-qwtlE3t9om8E9wLAQU5n67ph83EG3XT3vunNFYdHGwlYBjAwNcdKEWFEwgMdDqixbzaXDRdhe-Y0C+z4ylutg7pOl4zia94AF7ROBdLUGBkFtOevawZgP4wEgHBysOo6yuODzYSBIB1KwLh8ERjBoTKjF0hh0HAVe4CZNM1EwPRI5hGOzATuxM6ft+v6iNUjQtmAUiiCqcqMIyq7UDed4Pk+zGiG+IlyF+eEtlJ3b0nJCkLspLaqbeIgaSh2n-KIhDUbs+56eJQJGausnyYpFkAQYTD3o+dk6RRHFiQZkmLMZ3lmUpP5-nUAU2cFWlvo5zmsmFon6RJnkyaZvkJaIkwwEFmlgaFrmWrlHnRV5hXmcVpXlSFDlOawLk4TV7mGfVBWiAATEVKlqSlFUylV3URXl-UmUNI2WWNrVpe1mW6T1kX5fNw1Nau9TJStlX-BtM11dJO2Lf5gW2at74dV1lFnX1F3ebt8Wri1t3HWY1XPVFr1ye9flfalP0ZZ1WXVbWUBCD+wXeuUa7hieZ67tlKRJTdYOTQ5-3-vUZXptVQh0OUUB2VprFYdV4zUe+Q4MWBjP8YQgnCRjFiMPTfGjttsW82EG103RLN83NAtiwJD1Q91IsM8RAn84V3pxJ0gu+LT3Oi4rbPKz5qtGOrUtszLwvawrjCswDMWFbQspsHQ5s8ybNsNT59uOxDj0cfLGtuwNCl4QRmtyxb-v60Hiwh97suUX7ruR-SXG0qwcCcwnusB-NClgCnPGx87OtW+LgM+UbZMwN477UbRlvMQAfoNACcKoqnQzdF5b1tJxXUhV8htcGMXjfygALAA7NQce++HicS4VmdM7SXcRwvPlL1pZsZ3PWdJ5IJ07y7e-rwpB-3etR-Fz36+7brq-z2Xd8l9Ll9a8fL967fyNqwwGsPyfJ+P8K4U1dtvd+19S62wWp7G8ADP7ZzesCGADsbyFyvt3KB7thrByJBAzBStv64NNm-MOH8b5ALztxNO8CKHQOGlQ1OvFwFkMgYQoBfcB41xosPeuL4G4qgnjANUTsMFrw4fQfu1dRBDxHvwmA0RZQTwABy0KwQNYam8XxqPYfQxyu9l50hYfHAxdDsESEYIffB4i9Hn3QdYrSSc5zMAXE2GMK4YImJ5o40+a55yLmXKuYxs9vFgScSjYJM4-Y+LLgpGGcMIAI0YOUVeMToFxOgAkpJSNImYGiWE3xhA+hoT-O48iDiCmxMcsUyYS4yktlyVzUJMp9bDWca4up4gPGpMqXo9pAT6n2NYe+NJ5jDw9Jad-Y8jT8mTI4Zk7miSnyIxnlE8OoyNFLgWfDZZySIBDK8XRDZl0il1BKZ07pYjjlINOecwJDTSFeICvBRBhVoDEEyD+KIm4iDO2eYuJO7zPmnn2boIgByQn-LEICgAHtWGw74jDEAKDZOg9JcDdj+VAF5sL4XISRSi+8aKRxQGMk5dsEK1lYxxb45iWKaVVK3o8yF2KAW+I+VgIQW56VsqqRyrlp5KV5O5lC15Pl4KsCQiM7RR9RVJwlVKuyMyRWsuhb42RfCV6ytVWKoOPC5EymVdS3l6SPy4FKixX52qGWmvkFAC1PySGQx5WqqppNyYoRdbq+yZNoBKuZVSuVvj7UuMMV6pOIaFxMuddak15igVfNBVa9+QagEJpBY6oVTTU16IgHC8UiLkU3WJRi8pZCc3xvzQipcRbUXotJUEpKugs10wrZsulsbXV6OjT7QNOrWmSUyJyxg3LO1iuGvykdgqjVtsugq5CHaU39u-vO6VhqA3CuNV28xGr6KLvLcuoBu7GY9tWZu2dSC7UOrBaHJ5h69FXraJap1vbz33vMe6v1+6702o-YwX1FNT3hu-pGsNY6B2gaA5zSNrBvnUxYNU2shkkAZQpY0mDcGQWYQQ0UpDkkUPUgUBtDD+yBbEBQ-Bh5MbqokZzvSCjWHoJZtowLMADG0YNJsER6DkwhzfKQeR1GUEujMd47B0jQN8NCew5xhUxGxP8ck2x6TTH0MKYkwtZTlHHJcclDR3jhi7KUY2qDCar48a1VKQGACRMNp2NdqRISZb+wUE1HCCIuokQGnJGiE0GJsjmmxDaMMvo1D5UIGoMqWA1CEbAJUdTEWRB1EyMMO04wHR1hdGSPwgRKx6EMEYJInoLBWExUGXYIAOR3G7GoAAQkQVkmBvT9BgIV6IIkPRinWM2ZkwZzDRljE17mDQ2u-VgtCXCsG3S5i60mBoOIaBCElGKVQFjmBukwEwMgIIZiYHFMtwQAT5uNfAP8LKoApCwe630Pkcw2jCEIMidMF2rtkHlHUdwm32A9hVK51Ys3zBvh0K0K2AhVuSHWzoLb5gds6H22DxcOlMB-BXK8S7wh1iqRhe1pUWU1R3bKo9hIaPXvmHe59t433VSubyyuWgfQcygEYLKAAVhABgrAQ7cAsM4+F2Q8tMASmVaYuRBjlhyCqTAvpux2rwd1cQyKfylDoMQcTt6OLeksF5lEG1HDVlrE6III4YUABUqfwE-P0IIVoVzRm5rMCgQA)** in the planner, or
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
