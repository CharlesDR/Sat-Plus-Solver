/**
 * Hover help (every string in one place for easy edits). An element with
 * `data-help="<key>"` shows `HELP[key]` after a short delay on hover or
 * keyboard focus (see `ui/HelpTip.tsx`). A key with no entry shows nothing.
 *
 * Keys: `setting:<SettingKey>`, `tab:<world panel>`, `col:<table header>`,
 * `plan:<summary section>`, `stat:<plan stat label>`, and named ones.
 */
export const HELP: Readonly<Record<string, string>> = {
  // Settings (world defaults or one factory's overrides).
  'setting:objectives':
    'What the solver minimizes, in order. Each later objective only breaks ties left by the ones above it.',
  'setting:alternates': 'Let the solver use every alternate recipe, unlocked or not.',
  'setting:maxTier': 'Only use recipes unlocked at or below this tier.',
  'setting:costImports':
    'Count imported parts at what they cost to make, so the solver does not import freely.',
  'setting:avoidFluidByproducts':
    'Prefer recipes that leave no fluid byproduct behind, since fluids cannot be sunk.',
  'setting:simplicity': 'Prefer plans with fewer distinct recipes, at a small cost elsewhere.',
  'setting:tolerance':
    'How much an earlier objective may give up for a later one. Smaller keeps earlier objectives stricter.',
  'setting:wholeMachines': 'Round every recipe up to whole machines.',
  'setting:minerFluids': 'Which fluids miners may use to boost their output.',
  'setting:minerFluidSupply':
    'Whether miner fluids are made in this factory or supplied from another one.',
  'setting-reset': 'Overridden here. Click to use the world default again.',
  'setting-inherited': 'Inherited from the world defaults.',
  'settings-changed': 'A setting in here is changed.',

  // Targets.
  'target-for-links':
    'Made for links to other factories. What links do not take is spare, shown as surplus.',
  'target-kept': 'Made and kept here, for storage or the depot. Links never take it.',
  'target-remove': 'Remove this target.',
  'import-remove': 'Remove this import.',

  // World panels.
  'tab:Ledger': 'Every part in the world: made, used, moved and left over.',
  'tab:Factories': 'Each factory with its status, targets, links and size.',
  'tab:Links': 'What each link asks for and what it actually gets.',
  'tab:Shortfalls': 'Where new demand outruns factories you have already built.',
  'tab:Power': 'Power drawn and generated, by factory and group.',
  'tab:Nodes': 'Resource nodes in use against what the map has.',
  'tab:Groups': 'Groups of factories on the world canvas.',

  // Table headers.
  'col:Produced': 'Made per minute.',
  'col:Consumed': 'Used per minute.',
  'col:Target': 'Asked for by targets per minute, For links and Kept together.',
  'col:Imported': 'Brought in from outside the world or scope.',
  'col:Exported': 'Sent out of the scope.',
  'col:Surplus': 'Made but not used or sent anywhere.',
  'col:Spare': 'For links that no link takes yet. New links can draw on it.',
  'col:Stored': 'Kept by targets, never sent on links.',
  'col:Unmet': 'Needed but not supplied by anything.',
  'col:Link demand': 'What links pull from this factory.',
  'col:Requested': 'What the consumer asks this link for.',
  'col:Delivered': 'What the producer sends on this link.',
  'col:Used': 'What the consumer actually uses of it.',
  'col:Short': 'Requested but not delivered.',
  'col:Map pool': 'Nodes of this kind on the map, or your own count.',
  'col:Draw MW': 'Power the machines draw.',
  'col:Gen MW': 'Power generated.',
  'col:Generation MW': 'Power generated.',
  'col:Net MW': 'Draw less generation. Above zero needs more power.',
  'col:Machines': 'Machines to build, rounded up per recipe.',

  // Plan summary sections and stats.
  'plan:imports': 'Parts this factory gets from links or outside.',
  'plan:exports': 'Parts sent out of the scope.',
  'plan:surplus': 'Parts made and left over. Byproducts land here too.',
  'plan:nodes': 'Resource nodes the miners use.',
  'stat:Status': 'Whether the solver found a plan, and how long it took.',
  'stat:Power net': 'Power drawn less power generated, in MW.',
  'stat:Machines': 'Machines to build. Running counts fractional use.',
  'stat:Resource nodes used': 'Nodes the miners in this plan occupy.',

  // Built factories (A92).
  'built-factories':
    'What a factory marked as built does when links pull more than it was built for.',
  'built-hold': 'Built factories keep their size. Extra demand shows as a shortfall to fix.',
  'built-grow': 'Built factories grow with demand, and their build flags say what to add.',
  'shortfall-compare': 'Re-solve with each fix to see what it costs.',
  'shortfall-scale-up':
    'Let this factory and the built ones feeding it grow. Mark them as built again once built in game.',
  'shortfall-add-site':
    'Make a new factory that covers the rest. The built factory stays as built.',

  // Other buttons and labels.
  'world-name': 'The world name. Click to rename.',
  'quick-search': 'Search parts, factories and actions (Ctrl+K).',
  undo: 'Undo the last edit (Ctrl+Z). In a factory with manual edits or tweaks, Ctrl+Z undoes those first.',
  redo: 'Redo the undone edit (Ctrl+Y).',
  'undo-tweak': 'Drop the last plan tweak (Ctrl+Z here).',
  'undo-manual': 'Undo the last manual edit (Ctrl+Z here).',
  'fix-miner-fluids':
    'Make the miner fluid that factories get supplied from outside, in one factory linked to each.',
  'mark-all-built': "Save every factory's current plan as the one built in your game.",
  'mark-built': 'Save the current plan as the build.',
  'manual-from-build': 'Switch to manual mode with the plan as built.',
  'exact-numbers': 'Show 4 decimals and exact fractions instead of 2 decimals.',
  'area-ports': 'Distinct parts coming into this area (imports too) and going out of it.',
  'rename-area': 'Double-click to rename.',
  'save-menu': 'Save, load, export and share.',
  'sub-factory': 'A sub-factory shows inside its parent.',
};

/** The help text for a key, if any. */
export const helpText = (key: string | undefined): string | undefined =>
  key === undefined ? undefined : HELP[key];
