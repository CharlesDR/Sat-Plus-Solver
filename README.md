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

- **[Open the sample world](https://charlesdr.github.io/Sat-Plus-Solver/#w=N4IgtgpgLghiBcoBuCCMBmANCAJjWAEjAM4AWCIIAvtgGYwDGUA9gE4CWExCA2qOzgrtWzAHYBaAO5sA1t2yiYkCgEkRogAQB1WfJABzEQFcADisHwQxWKygRWIbKwgBHI1ygJQN-dG7weAF0aECNFYmJ2fVEIHBUwEzYofyDsEw42digATwQABgVmO38QAFkYGS4NKFIIDRMAG3wqmrraViU2xhZWbPqjBobiADpHEGdiZiNWBi4vEKhJCAqU4Mx+CxB2zr1FZUsAMQ7IDQPutlzsQymzTesYW3sx5zcPLxAfP15+OzAKMGYOAGD3E22UTmaCAArFQ1qFwpForF4olbKs0hkODl8oVihRnlwpjM5ogFksVrw1hsKNYIBAGuIwOxBmM9hAKABlOz0jSlZkNAmvazvT7Jb4gLIQP6WWn08QAI2WfwhdjQeVhITCJERMTiCSS6JA6XYmWx8AKIFERRJlCchOms38wDJyzklJo1MsDGYMAZiSWDgUnQoAGEfQ0NAAFZgBsbXUzmCj+p52oWeRAfB6+MUBH5S-6SZ6Q+DoPLqwJ2hjsEwk0C+zgSZOscQwIz6SCiOwOeD0IYQbDyk1gbUK6Yxbu94j9kAMB7ysTif04ezib2+8S+cf4NgISfTtcMg8biBbnq731TujsBiTUTsIxgUHuBkiHDiURGBgNZbNpuLpqduefZ0M+T5ypu9jbhOF7Tiad4AF6xGBDK0KBEEdGePYwdg34wEgXAKkOI7ymOTxYcBIANOwbgCIRzCoXKDEMuhUFAZe4DZLMVEwHRw4RKOrDjmx04fl+P7iLUzTNmAMjiKgCrMMyK60Net73o+THiK+wkKJ+uHNpJXaMrJ8nzkpzYqTeYjqchWmAuIxBUfse66WJIKGSuMlyQp5n-kYLB3g+tnaeR7GifpEnLEZXmmYp36-g0-nWUFmmvg5TnsqFIl6eJHnSSZPnxeI0wwIFGmgSFLmWjl7lRZ5BVmUVJVlcF9mOewznYdVbkGXV+XiAATIVymqcl5VypVXXhblfXGYNw0WaNLWpW1GU6d1EV5XNQ2NSujRJctFWAut021VJ20LX5AU2Stb7tZ1FGnb151eTtcUrs1N1HRYVVPZFL2yW9vmfSl33pR1mVVTWUAiN+QXepUq7hsep47llaSJddoMTfZf1-o0pXplVIgMJUUC2ZpLGYVVkxUW+g70aBDN8cQAlCejVjMHTvEjltMU8xE6207RzO87N-Oi-x92Q11wv00R-F8wV3oJN0Av+DTXMiwrrNK95KsmGrkus9LQta-LzAs-90UFfQ8ocAwZvc8b1v1d5dsO+DD3sXL6uu-18m4fhGuy+bft64HyzB17MsUb7LsR4ynH0uwcAc-HOv+3N8lgMn3Ex072uW2LAPeYbpMwL4b5UTRFtMQAfgNACcqCoAwTeFxbVuJ+XMiV0hNdGEXDeKgALAA7LQsc+2HCfiwVGeM-Snfh-P3mL5ppvp7PmeJ9Ix3b87u9r-J+93Wth9F93a87TrK9z6Xt-F1LF+a0fz+6zfSOq0w6v38fj9v7l3Ji7Leb8r4lxtvND215-4fyzq9UEMB7bXgLpfLukC3ZDSDiScBGDFZfxwSbV+od37X0AbnLiqc4HkKgUNShKceJgNIRAghgDe792rtRIeddnz11QOPGAqA8iO3QavdhjA+5V3EIPYefCYCxHlOPAAHDQzB-Uhob2fGothdCHI7yXgyZhccDG0KwVIZgB88HiL0WfNB1jNKJ1nKwecjYYzLmgiY7mjiT6rjnAuJcK5jEz28aBJxyNgnTl9j40u8loawwgPDZglQV4xKgXE6ACSkmI0idgaJYTfHEAGKhX87iyIOIKbEhyxTpiLjKc2XJnNQlyj1kNZxri6mSA8akypej2kBPqfYlhb40nmIPD0lpX8jyNPyZM9hmSuaJMfAjaeUSw6jI0YuBZcNlnJIgEMrxtENkXSKQ0EpnTuliOOYg055zAkNJIV4-ycEEEFWgKQbI34YgbhIE7Z5C5E7vM+SefZ+gSAHJCf8iQgKAAeVY7BvhMKQIo1kGCMnwF2P5UAXmwvhUhJFKK7xouHFAIyjk2wQrWZjHFvimJYppVUzejzIXYoBb4j5OARCbnpWyqpHKuUnkpXkrmULXneTguwRCIztGH1FYnCVUrbIzJFay6FvjZG8OXrK1VYrA7cLkXKZV1LeXpPfPgEqzFfnaoZaaxQUALU-OIRDHlaqqkkzJshF1uq7Kk2gEq5lVK5W+PtS4wxXrE4hvnEy511qTXmKBV80FVq35BsAQmkFjqhVNNTXoiAcLJSIuRddYlGLymkJzfG-NCLFxFtRei0lQTEr6CzbTCtmy6WxtdXo6N3tA06taRJbInLmDcs7WKoa-KR2CqNW2i6CqkIdpTf2r+87pWGoDcK41XbzEaroou8ty7AG7oZj21Zm7Z2ILtQ6sFIcnmHr0VejolqnW9vPfe8x7q-X7rvTaj9zBfXk1PeGr+kaw1joHaBoDHNI3sG+VTNg1SawGSQOlCljSYNwZBRhBDRSkMSRQ7SJQ60MP7P5qQFD8GHkxqqiR7OjIKNYaglm2j-MwAMdRg0uwRHoPTEHN8xB5GUaQR6Mx3jsHSOA3w0J7DnGlTEbE-xyTbHpNMfQwpiT81lOUYclx6UNHeOGNspR9aINxovlxjVUpAZ-yE3WnYl2JFBJlr7FQTUCIoi6hRAaSkGITRYlyOaXENowy+g0HlYgGhSo4A0IRsA1R1MRbEA0bIow7STAdLWF0FIAjBArAYYwJgUieisDYTFQZ9ggC5A8LsGgABCJB2TYG9IMGAhXYjCQ9BKTYTZWTBksNGWMTWuZNDaz9GCsIcKwbdLmLrSYmh4joCIaUEp1AWNYG6bALAKBgjmNgSUy3hABPm418AgJMqgBkLB7rAwBQLA6KIYgqJ0wXauxQRUDRPCbc4N2VArn1izcsK+PQ7RLZCFW9IdbegtuWB23ofbYOFzaWwACZc7xLuiE2CpGF7WVSZWEXd0qj2kho9e5Yd7n2PjfbQK5vLy56ADBzKAZg8oABWEAmDsGDrwKwzj4W5DyyweKpVZj5GGGWPIqBsC+i7Ha3BXVJDIu-OUBgpBxO3vYt6awXm0TrWcFWGsToQjDhhQAFSp-AD8gwpdIEUjgA4iUBC1eyOkQEn4cww3cCEK0y5oxc3mFQIAA)** in the planner, or
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
