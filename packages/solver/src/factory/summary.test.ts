import { expect, test } from 'vitest';
import { formatRate, recipeTable, type PlanSummary } from './summary';

test('formatRate: 3 decimals, 3 significant digits below 0.001, no negative zero', () => {
  expect(formatRate(60)).toBe('60');
  expect(formatRate(13.33333)).toBe('13.333');
  expect(formatRate(0.000626123)).toBe('0.000626');
  expect(formatRate(0)).toBe('0');
  expect(formatRate(-0.0000001)).toBe('-1.00e-7');
  expect(formatRate(-0.0004)).toBe('-0.000400');
  expect(formatRate(-0.0)).toBe('0');
  expect(formatRate(Infinity)).toBe('Infinity');
});

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
    rows: [['Iron Ingot', 'Smelter', '2.5', '3', '10']],
  });
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
      ['Iron Ingot', 'Smelter', '2.5', '3', '', '10'],
      ['Solid Fuel Heater Mk.1 (Coal)', 'Solid Fuel Heater Mk.1 (MP)', '8', '8', '93.75%', '0'],
    ],
  });
});
