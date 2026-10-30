import { expect, test } from 'vitest';
import {
  buildBill,
  buildingTable,
  materialTable,
  mergeBills,
  QUIET_NUMBERS,
  recipeTable,
  type PlanSummary,
} from './summary';

const plan = (recipes: PlanSummary['recipes']): PlanSummary => ({
  status: 'ok',
  objective: 'resources',
  diagnostics: [],
  recipes,
  targets: [],
  imports: [],
  byproducts: [],
  items: [],
  nodes: [],
  extraction: [],
  power: { consumptionMW: 0, generationMW: 0, netMW: 0 },
  bill: { buildings: [], materials: [] },
});
const smelter = {
  id: 'iron-ingot',
  name: 'Iron Ingot',
  machine: 'Smelter',
  machineId: 'smelter',
  machines: 2.5,
  machinesCeil: 3,
  powerMW: 10,
  inputs: [{ item: 'iron-ore', name: 'Iron Ore', rate: 75 }],
  outputs: [{ item: 'iron-ingot', name: 'Iron Ingot', rate: 75 }],
};

test('recipeTable: no Boiler column without heaters', () => {
  expect(recipeTable(plan([smelter]))).toEqual({
    head: ['Recipe', 'Machine', 'Count', 'Build', 'MW'],
    rows: [['Iron Ingot', 'Smelter', '2.5', '3', '10.0']],
  });
});

test('recipeTable: a count the decimals cannot show exactly carries its fraction (A41)', () => {
  expect(recipeTable(plan([{ ...smelter, machines: 7 / 3 }])).rows[0]![2]).toBe('2.3334 (2 1/3)');
});

test('recipeTable: heaters show whole machines and their boiler load (A17)', () => {
  const heater = {
    id: 'h',
    name: 'Solid Fuel Heater Mk.1 (Coal)',
    machine: 'Solid Fuel Heater Mk.1 (MP)',
    machineId: 'solid-fuel-heater-mk-1-mp',
    machines: 8,
    machinesCeil: 8,
    powerMW: 0,
    boilerLoad: 300 / 320,
    inputs: [],
    outputs: [],
  };
  expect(recipeTable(plan([smelter, heater]))).toEqual({
    head: ['Recipe', 'Machine', 'Count', 'Build', 'Boiler', 'MW'],
    rows: [
      ['Iron Ingot', 'Smelter', '2.5', '3', '', '10.0'],
      ['Solid Fuel Heater Mk.1 (Coal)', 'Solid Fuel Heater Mk.1 (MP)', '8.0', '8', '93.75%', '0.0'],
    ],
  });
});

test('recipeTable: with io, Inputs and Outputs follow the machine (UX-4)', () => {
  expect(recipeTable(plan([smelter]), { io: true })).toEqual({
    head: ['Recipe', 'Machine', 'Inputs', 'Outputs', 'Count', 'Build', 'MW'],
    rows: [['Iron Ingot', 'Smelter', 'Iron Ore 75.0', 'Iron Ingot 75.0', '2.5', '3', '10.0']],
  });
});

test('recipeTable: the quiet format shows 2 decimals and no fraction (UX-6)', () => {
  const row = recipeTable(plan([{ ...smelter, machines: 7 / 3, powerMW: 0.001 }]), {
    format: QUIET_NUMBERS,
  }).rows[0]!;
  expect(row[2]).toBe('2.34');
  expect(row[4]).toBe('<0.01');
});

// TI-1: two building types; the constructor runs two recipe groups.
const billModel = {
  items: [
    { id: 'iron-plate', name: 'Iron Plate' },
    { id: 'cable', name: 'Cable' },
    { id: 'screws', name: 'Screws' },
  ],
  machines: [
    {
      id: 'constructor',
      name: 'Constructor',
      powerMW: 4,
      buildCost: [
        { item: 'cable', amount: 2 },
        { item: 'iron-plate', amount: 10 },
      ],
    },
    { id: 'smelter', name: 'Smelter', powerMW: 4, buildCost: [{ item: 'cable', amount: 1.5 }] },
  ],
} as unknown as Parameters<typeof buildBill>[0];
const groups = [
  { machine: 'constructor', count: 3, recipe: 'iron-plate' },
  { machine: 'constructor', count: 2, recipe: 'screw' },
  { machine: 'smelter', count: 4, recipe: 'iron-ingot' },
];

test('buildBill: buildings summed over recipe groups, materials over buildings (TI-1)', () => {
  const bill = buildBill(billModel, groups);
  expect(bill.buildings.map((b) => [b.name, b.count, b.expand])).toEqual([
    ['Constructor', 5, undefined],
    ['Smelter', 4, undefined],
  ]);
  expect(bill.materials.map((m) => [m.name, m.amount])).toEqual([
    ['Cable', 5 * 2 + 4 * 1.5],
    ['Iron Plate', 50],
  ]);
  expect(buildingTable(bill)).toEqual({
    head: ['Machine', 'Build'],
    rows: [
      ['Constructor', '5'],
      ['Smelter', '4'],
    ],
  });
  expect(materialTable(bill, QUIET_NUMBERS).rows).toEqual([
    ['Cable', '16'],
    ['Iron Plate', '50'],
  ]);
});

test('buildBill: To expand is max(0, now − built) per recipe group (TI-1)', () => {
  // Built: 1 plate constructor, 4 screw constructors (the plan now needs 2), 4 smelters.
  const built = new Map([
    ['iron-plate', 1],
    ['screw', 4],
    ['iron-ingot', 4],
  ]);
  const bill = buildBill(billModel, groups, built);
  // Plates add 2; the 2 spare screw constructors don't count against them.
  expect(bill.buildings.map((b) => [b.name, b.count, b.expand])).toEqual([
    ['Constructor', 5, 2],
    ['Smelter', 4, 0],
  ]);
  expect(bill.materials.map((m) => [m.name, m.expand])).toEqual([
    ['Cable', 4],
    ['Iron Plate', 20],
  ]);
  expect(buildingTable(bill)).toEqual({
    head: ['Machine', 'Build', 'To expand'],
    rows: [
      ['Constructor', '5', '2'],
      ['Smelter', '4', ''],
    ],
  });
  expect(materialTable(bill).rows).toEqual([
    ['Cable', '16', '4'],
    ['Iron Plate', '50', '20'],
  ]);
  // A group added since the mark counts whole.
  const added = buildBill(
    billModel,
    [...groups, { machine: 'smelter', count: 2, recipe: 'x' }],
    built,
  );
  expect(added.buildings[1]!.expand).toBe(2);
});

test('mergeBills: several factories sum per building (A81)', () => {
  const a = buildBill(billModel, groups.slice(0, 1));
  const b = buildBill(billModel, groups, new Map([['iron-plate', 3]]));
  const sum = mergeBills([...a.buildings, ...b.buildings]);
  expect(sum.buildings.map((x) => [x.name, x.count, x.expand])).toEqual([
    ['Constructor', 8, 2],
    ['Smelter', 4, 4],
  ]);
  expect(sum.materials.find((m) => m.item === 'iron-plate')).toMatchObject({
    amount: 80,
    expand: 20,
  });
});
