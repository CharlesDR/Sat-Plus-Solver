import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { HELP, helpText } from './help';
import { placeTip } from './ui/HelpTip';

const src = new URL('.', import.meta.url).pathname;
const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });

describe('hover help', () => {
  test('every fixed data-help key has text', () => {
    const keys = sources(src).flatMap((path) =>
      [...readFileSync(path, 'utf8').matchAll(/data-help(?:=|: )["']([\w:-]+)["']/g)].map(
        (m) => m[1]!,
      ),
    );
    expect(keys.length).toBeGreaterThan(10);
    expect(keys.filter((k) => helpText(k) === undefined)).toEqual([]);
  });

  test('every setting, world panel tab and new ledger column has text', () => {
    for (const k of [
      'objectives',
      'alternates',
      'maxTier',
      'costImports',
      'avoidFluidByproducts',
      'simplicity',
      'tolerance',
      'wholeMachines',
      'minerFluids',
      'minerFluidSupply',
    ])
      expect(HELP[`setting:${k}`], k).toBeTruthy();
    for (const t of ['Ledger', 'Factories', 'Links', 'Shortfalls', 'Power', 'Nodes', 'Groups'])
      expect(HELP[`tab:${t}`], t).toBeTruthy();
    for (const c of ['Spare', 'Stored', 'Short']) expect(HELP[`col:${c}`], c).toBeTruthy();
    expect(helpText(undefined)).toBeUndefined();
  });

  test('the tip sits below, flips above near the bottom, and stays on screen', () => {
    const view = { width: 800, height: 600 };
    const tip = { width: 200, height: 40 };
    expect(placeTip({ left: 100, top: 100, width: 50, height: 20 }, tip, view)).toEqual({
      left: 25,
      top: 126,
    });
    expect(placeTip({ left: 100, top: 570, width: 50, height: 20 }, tip, view)).toEqual({
      left: 25,
      top: 524,
    });
    expect(placeTip({ left: 0, top: 0, width: 10, height: 10 }, tip, view).left).toBe(6);
    expect(placeTip({ left: 790, top: 0, width: 10, height: 10 }, tip, view).left).toBe(594);
  });
});
