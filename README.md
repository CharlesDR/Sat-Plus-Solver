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

- **[Open the sample world](https://charlesdr.github.io/Sat-Plus-Solver/#w=N4IgtgpgLghiBcoBuCCMqA0IAmNYAkYBnACwRBAF8sAzGAYygHsAnASwiIQG1Q3tybFkwB2AWgDurANZcsImJHIBJYSIAEAdRlyQAc2EBXAA7KB8EEVgsoEFiCwsIAR0OcoCUNb3Qu8bgC61CCGCkREbHoiENjKYMasUH6BWMbsrGxQAJ4IAAzyTLZ+IACyMNKc6lAkEOrGADZ4ldW1NCyKrQzMLFl1hvX1RAB0DiBOREyGLPScnsFQEhDlyUEYfOYgbR26CkoWAGLtkOr7Xaw5WAaTphtWMDZ2o06u7p4g3r48fLZg5GBM2H69zEWyUjiaCAArJRViEwhEojE4gkbCtUul2Nk8gUiuQnpxJtNZoh5otljxVutyFYIBB6mIwGwBqNdhByABlWx09QlJn1fEvKxvD5JL4gTIQX4WGl0sQAIyWv3BtjQuRhwVCxAR0Vi8USaJAaTYGSx8HyIBEhWJFEcBKmMz8wFJS1kFOoVIs9CYMHpCUW9nkHXIAGFvfV1AAFJj+0ZXExmch+x62wUeRDve4+UX+b6Sv4SJ4Q+AAZlyaoCtvobGMxNAPo44iTLDEMEMekgIls9ngdEGECwcuNYC18qm0W7vaI-ZA9HuctEYj92DsYi9PrEPnHeFYCEn07X9IPG4gW+6u59U9obHoExEbEMYBBbnpwmwYhEhno9SWzabi8anbnn2tDPk+sqbnY24The07GneABeMRgfSNCgRB7Rnj2MFYN+MBIJw8pDiOcpjo8WHASA9RsK4-CEUwqGygx9LoVBQGXuAWQzFRMB0cO4Sjiw45sdOH5fj+Yg1E0zZgNIYioPKTBMiuNDXre96PkxYivsJ8ifrhzaSV2DKyfJ85Kc2Kk3qI6nIVpAJiEQVF7HuulicChkrjJckKeZ-6GMwd4PrZ2nkexon6RJSxGV5pmKd+v71P51lBZpr4OU5bKhSJeniR50kmT58ViFMMCBRpoEhS5Fo5e5UWeQVZlFSVZXBfZjlsM52HVW5Bl1flYgAEyFcpqnJeVsqVV14W5X1xmDcNFmjS1qVtRlOndRFeVzUNjUrg0SXLRVALrdNtVSdtC1+QFNkrW+7WdRRp29edXk7XFK7NTdR3mFVT2RS9slvb5n0pd96UdZlVU1lAwjfkFXoVKuYbHqeO5ZakiXXaDE32X9f4NKVaZVcI9AVFAtmaSxmFVRMVFvoO9GgQzfFEAJQno5YTB07xI5bTFPPhOttO0czvOzfzov8fdkNdcL9NEfxfMFV68RdALfg01zIsK6zSveSrxhq5LrPS0LWvy0wLP-dFBV0HK7D0Gb3PG9b9XeXbDvgw97Fy+rrv9fJuH4Rrsvm37euB0swdezLFG+y7EcMpxdJsHAHPxzr-tzfJYDJ9xMdO9rltiwD3mG6TMA+G+VE0RbTEAH4DQAnOg9BN4XFtW4n5fSJXSE14YRcNwqAAsADsNCxz7YcJ+LBUZ4zdId+Hc-eQvmmm+nM+Z4nUjHVvzs76v8l73da0H0XXerztOvL7Ppc38XUvn5rh9P7r19I6rjDq3fR8P1-cu5MXab1fpfEuNt5oe2vH-d+WdXoghgPba8BcL6dwgW7IaQdiRgPQYrT+2CTYv1Dm-K+ADc5cVTrAshkChoUJTjxUBJDwH4IAT3Pu1dqKDzrs+euqAx4wFQLkR2aCV5sIYL3KuYgB5D14TAGIcox4AA5qEYP6kNdez5VGsNoQ5bei96RMLjvomhmDJBMH3rgsRujT6oKsZpROs4WDzkbNGZc0FjHcwccfVcc4FxLhXEY6eXjQKOORkE6cvtvGl3ktDWGEB4ZMAqMvaJkDYnQHiYkxGESsBRNCT4og-RUK-jcWRex+SYkOSKVMRcpTmw5M5iE2UeshpOJcbUiQ7iUkVN0W0-xdS7HMLfKksxB5unNM-keBpeSJlsIyVzBJj4EZT0iWHEZ6jFzzLhkspJEBBmeNousi6hT6jFI6V00RRyEEnLOQE+pxDPH+TgvAgq0ASBZG-NEDcxAnZPIXInN5HyTx7L0MQfZwS-niABQADyrLYN8xgSCFGsvQBkeAuy-KgM8mFcKkKIuRXeVFw4oBGUcm2cFqzMbYp8UxTF1LKkbweRCrF-yfHvOwMITcdLWWVPZZyk8FLclc0hS87ycE2CIWGVog+IrE7islbZaZwqWVQp8TInhS8ZUqtFYHLhsjZRKqpTytJ748AlWYj8rV9KTUKCgOa75RCIbctVZUkmZNkLOp1XZUm0BFVMspbKnxdrnEGM9YnYN85GVOqtcasxgLPkgsta-QNAD43AodYKxpKbdEQFhRKBFSLrpEvRWUkh2a415vhYuQtKK0UksCYlPQmbablo2bSmNLrdFRu9gG7VLSJJZA5UwLlHbRVDT5cOgVhrW0XXlUhdtya+2fznVKg1-qhVGs7WY9VdEF1lqXQAndDNu0rI3TOhBtr7WgpDo8g9ujL3tAtY6ntZ671mLdb6vdt7rXvqYD68mJ6w2fwjaG0d-aQOAY5hGtgXyqasCqTWAySB0rkoadB2DwKMLwcKYhiSyGaSKHWuhvZ-MSDIbg-c6NVViPZwZORzDUFM00f5mAejqN6m2EI1BqYg4vkILIyjSC3QmM8ZgyRwGeHBNYY44qIjom+MSdY1JxjaH5PifmkpijDlONSmozxgxtkKPrRBuNF8uMaolP9P+Qm61bEuxIoJUtfZKAanhJEHUyJ9QUnRMaTEOQzQ4mtKGH06g8pEHUKVbA6gCNgCqGp8Loh6hZBGLaCY9pazOnJP4IIFZ9BGGMMkD0lhrAYsDHsEAnJ7hdnUAAIWIGyLAXoBgwAKzEYS7pxQbCbCyIMFgowxka1zRorWfowRhDhGDrocydcTI0XEtBhBSnFGocxLBXRYGYOQUEswsASiW0Ifxc2GvgABJlUA0gYNdf6PyeY7QRBEBRGmc7l3yAKnqB4DbHBuyoBc2sGbFhXy6DaJbQQK2pBrd0Jtiw23dB7dBwubSWB-jLjeBdkQGwVLQra8qTKQjbulQe4kVHL2LBvY++8L7aAXO5eXHQfo2ZQBMDlAAKwgIwNgwceCWCcXCnIuXmDxVKjMPIQwyy5EwCAH0XZbU4K6hIJF34yj0BIGJm97EvRWE86idaTgqw1kdMEYc0KAAqlP4AfgGFgPCilsD7ESvwGrWQ0gAk-NmGGbhgiWmXFGLmcxKBAA)** in the planner, or
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
