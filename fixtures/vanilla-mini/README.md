# vanilla-mini

A small canonical `Model` (the `model.json` shape from `@sps/data`) with vanilla Satisfactory 1.0 recipes, used by the golden cases in `../golden/` and the solver's unit and property tests.

- Rates are vanilla per-minute rates at 100% clock. Miners are Mk.1 on normal nodes (60/min); the Oil Extractor gives 120 m³/min.
- Map node counts (iron 40, copper 10, limestone 20, coal 10, crude oil 5) are made up. They only matter for the `scarcity` objective and the pool budget.
- Only normal nodes exist, so the plan's production recipes can be compared one-to-one with satisfactory-tools, which models raw resources rather than nodes.

Each golden case's `description` says what satisfactory-tools shows for the same target and alternates.
