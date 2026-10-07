import { expect, test } from 'vitest';
import { recipeTable, type PlanSummary } from './summary';

const plan = (recipes: PlanSummary['recipes']): PlanSummary => ({
  status: 'ok',
  objective: 'resources',
  diagnostics: [],
  recipes,
  targets: [],
  imports: [],
  byproducts: [],
  nodes: [],
  extraction: [],
  power: { consumptionMW: 0, generationMW: 0, netMW: 0 },
});
const smelter = {
  id: 'iron-ingot',
  name: 'Iron Ingot',
  machine: 'Smelter',
  machines: 2.5,
  machinesCeil: 3,
  powerMW: 10,
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
    machines: 8,
    machinesCeil: 8,
    powerMW: 0,
    boilerLoad: 300 / 320,
  };
  expect(recipeTable(plan([smelter, heater]))).toEqual({
    head: ['Recipe', 'Machine', 'Count', 'Build', 'Boiler', 'MW'],
    rows: [
      ['Iron Ingot', 'Smelter', '2.5', '3', '', '10.0'],
      ['Solid Fuel Heater Mk.1 (Coal)', 'Solid Fuel Heater Mk.1 (MP)', '8.0', '8', '93.75%', '0.0'],
    ],
  });
});
