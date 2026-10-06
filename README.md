# Sat-Plus-Solver

A client-side production planner for the Satisfactory Plus (SF+) mod. It has two layers: a world of linked factories, and an LP/MILP solver inside each factory.

**Use it:** <https://charlesdr.github.io/Sat-Plus-Solver/>. Everything runs in your browser; nothing is uploaded.

## Using the planner

1. **World view (home).** Add factories, draw links between them on the canvas (drag from one factory's right handle to another's left handle), and group them. The panels below the canvas show the item ledger, factories, links, power, the node pool and groups. "Trace item" highlights everything that touches one item.
2. **Factory view.** Open a factory to set its targets, recipes (alternates are off until you turn them on), unassigned imports, resource limits and objectives. The plan shows as a flowchart of recipe groups and as a table.
3. **Diagnostics.** When a plan can't be made, the factory view says why and offers one-click fixes: turn on the recipe that makes a missing item, import what is short, or raise a node cap. The world view lists failed factories, short links and over-allocated nodes, each with a button that takes you to the fix.
4. **Saving and sharing.** The world autosaves in your browser after every edit. The **File** menu in the top bar keeps up to 10 named slots, exports and imports `.json` files, and makes share links for worlds that fit in a URL.
5. **Getting around.** Press **Ctrl+K** (Cmd+K on a Mac) to jump to a factory or add a target by name. The top bar also switches between light, dark and your system theme, and the factory settings sidebar can be hidden to give the flowchart the whole width.

### Sample world

[`examples/world.json`](examples/world.json) is a small save: an Iron Works that feeds a Frame Factory over a pulled Iron Plate link and a fixed Iron Rod link (both in the "Starter Base" group), a Steel Mill, and a 300 MW Coal Power plant.

- **[Open the sample world](https://charlesdr.github.io/Sat-Plus-Solver/#w=N4IgtgpgLghiBcoBuCAcAaEATGsASMAzgBYIggC+mAZjAMZQD2ATgJYSEIDaorWZrZowB2AWgDuLANadMwmJDIBJIcIAEAdWmyQAcyEBXAA5L+8EIVjMoEZiEzMIARwMcoCUFd3RO8LgF0qEAN5QkJWXWEILCUwIxYoXwDMIzYWVigATwQABjlGG18QAFkYKQ41KGIINSMAG1wKqprqZgUW+iZmTNqDOrrCADp7EEdCRgNmOg4PIKhxCDKkwPReMxBW9p15RXMAMTbINT3OlmzMfQmTdcsYa1sRxxc3DxAvH25eGzAyMEYsPp3USbRQORoIACsFBWwVC4Ui0Vi8WsyxSaTYWVy+UKZEeHAmUxmiDmCyW3BWazIlggEDqojArH6Ix2EDIAGUbLS1MVGXU8c9LK93olPiAMhAfuZqbTRAAjRY-ME2BAARhy0KCISI8KiMTiCVRIFSrHSmPgeRAwgKRPIDnxk2mvmAJMWMnJVEp5jojBgdPiCzscnaZAAwj66moAAqMAMjS7GUxkf0PO0C9yIN53bwivxfCW-cSPcHwADMOXV-jtdFYRiJoF97DEyeYohgBl0kGENjs8FoAwgmFlJrA2rlkyiPb7hAHIDod1lIlE-qwtlE3t9om8E9wLAQU5n67ph83EG3XT3vunNFYdHGwlYBjAwNcdKEWFEwgMdDqixbzaXDRdhe-Y0C+z4ylutg7pOl4zia94AF7ROBdLUGBkFtOevawZgP4wEgHBysOo6yuODzYSBIB1KwLh8ERjBoTKjF0hh0HAVe4CZNM1EwPRI5hGOzATuxM6ft+v6iNUjQtmAUiiCqcqMIyq7UDed4Pk+zGiG+IlyF+eEtlJ3b0nJCkLspLaqbeIgaSh2n-KIhDUbs+56eJQJGausnyYpFkAQYTD3o+dk6RRHFiQZkmLMZ3lmUpP5-nUAU2cFWlvo5zmsmFon6RJnkyaZvkJaIkwwEFmlgaFrmWrlHnRV5hXmcVpXlSFDlOawLk4TV7mGfVBWiAATEVKlqSlFUylV3URXl-UmUNI2WWNrVpe1mW6T1kX5fNw1Nau9TJStlX-BtM11dJO2Lf5gW2at74dV1lFnX1F3ebt8Wri1t3HWY1XPVFr1ye9flfalP0ZZ1WXVbWUBCD+wXeuUa7hieZ67tlKRJTdYOTQ5-3-vUZXptVQh0OUUB2VprFYdV4zUe+Q4MWBjP8YQgnCRjFiMPTfGjttsW82EG103RLN83NAtiwJD1Q91IsM8RAn84V3pxJ0gu+LT3Oi4rbPKz5qtGOrUtszLwvawrjCswDMWFbQspsHQ5s8ybNsNT59uOxDj0cfLGtuwNCl4QRmtyxb-v60Hiwh97suUX7ruR-SXG0qwcCcwnusB-NClgCnPGx87OtW+LgM+UbZMwN477UbRlvMQAfoNACcKoqnQzdF5b1tJxXUhV8htcGMXjfygALAA7NQce++HicS4VmdM7SXcRwvPlL1pZsZ3PWdJ5IJ07y7e-rwpB-3etR-Fz36+7brq-z2Xd8l9Ll9a8fL967fyNqwwGsPyfJ+P8K4U1dtvd+19S62wWp7G8ADP7ZzesCGADsbyFyvt3KB7thrByJBAzBStv64NNm-MOH8b5ALztxNO8CKHQOGlQ1OvFwFkMgYQoBfcB41xosPeuL4G4qgnjANUTsMFrw4fQfu1dRBDxHvwmA0RZQT1QLQrBA1hqbxfKo9h9DHK72XnSFh8d9F0OwRIRgh98HiN0efdBVitJJznMwBcTYYwrhgsYnmDjT5rnnIuZcq4jGzy8WBRxKMgkzj9t4suCkYZwwgAjRg5RV7ROgbE6A8TElIwiZgKJoSfGED6GhP8bjyL2PyTExyRTJhLlKS2HJXMQkyn1sNJxLjaniHcSkipui2n+LqXY1h75UlmMPN05p39jwNLyRMjhGTuYJKfIjGekTw4jPUUueZ8MllJIgIMzxdF1mXUKXUYpHSuliKOUgk5ZyAn1NIZ4gK8FEGFWgMQTIP4oibiIM7J5i4k5vI+aePZugiD7OCX8sQAKAAe1YbDviMMQAoNk6D0lwN2X5UBnkwrhchRFyL7yopHFAYyTl2zgtWVjbFPjmKYupZUreDyIVYv+T495WAhBbjpayyp7LOWngpbk7mkKXk+XgqwJCwytFHxFUncVkq7LTOFSyqFPjZF8JXjKlVoqg48LkTKJVVKeVpI-LgUqLEflavpSa+QUBzXfJIZDblqrKmk3JihZ1Or7Jk2gIqpllLZU+Ltc4gxnqk7BoXIyp1VrjVmMBZ8kFlr36BqAfG4FDrBWNJTboiAsLxQIqRTdIl6KylkOzXGvN8KlyFpRWiklgSkq6EzXTctGzaUxpdboqNPsA3apaZJTIHLGBco7aK4afLh0CsNa2y68rkLtuTX27+c6pUGv9UKo1nazHqvogustS6gE7sZt2lZG6Z1INtfa0FodHkHt0ZetoFrHU9rPXesxbrfV7tvda99jAfUUxPWG7+EbQ2jv7SBwDnMI2sC+dTFgVTayGSQBlclDToOweBZheDhTEOSWQ9SBQG10N7IFsQZDcH7nRuqsRnO9JyOYegpmmjAswD0bRvUmwhGoOTCHF8pBZHUZQS6ExnjMGSNAzw4JrDHGFREdE3xiTrGpOMbQ-J8TC0lMUccpxyU1GeMGLshRjaoMJqvjxrVEpAYAJEw2rY12pEhKlv7BQTUcIIi6iRAackaITQYmyOabENowy+jUPlQgagypYDUARsAlQ1PhZEHUTIww7TjAdHWF0ZI-CBErHoQwRgkiegsFYDFQZdggA5HcbsagABCRBWSYG9P0GABXogiQ9GKdYzZmTBnMNGWMjXuYNFa79WC0JcIwbdLmTrSYGg4hoEISUYpVDmOYG6TATAyAghmJgcUS3BD+Lmw18A-wsqgCkDBrrfQ+RzDaMIQgyJ0zncu2QeUdR3AbfYD2FULnVgzfMG+HQrQrYCBW5INbOhNvmG2zoPboPFw6UwH8FcrwLvCHWKpaFbWlRZTVLdsqD2Eio5e+YN7H23hfdVC53LK5aB9BzKARgsoABWEAGCsBDtwCwTi4XZFy0wBKZVpi5EGOWHIKpMC+m7LavB3VxBIp-KUOgxAxM3o4t6SwnmUQbUcNWWsToggjmhQAFUp-AT8-RJdICUlgPYSU+A1cyKkf4X4cyw1cEEK0K5ozc1mBQIAA)** in the planner, or
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
