import { describe, expect, test } from 'vitest';
import { Issues } from './issues';
import { parseNodesCsv } from './nodes';

const HEADER = 'resource,fracking_sites,impure,normal,pure,site_rate_m3_min';

function parse(text: string) {
  const issues = new Issues();
  return { rows: parseNodesCsv(text, issues), errors: issues.errors.map((e) => e.code) };
}

describe('parseNodesCsv', () => {
  test('parses counts and the optional site-rate override', () => {
    const { rows, errors } = parse(`${HEADER}\nCoal,0,15,31,16,\nNitrogen Gas,6,0,0,0,1200\n`);
    expect(errors).toEqual([]);
    expect(rows[0]).toEqual({ resource: 'Coal', sites: 0, impure: 15, normal: 31, pure: 16 });
    expect(rows[1]!.siteRate).toEqual({ n: 1200n, d: 1n });
  });

  test.each([
    ['wrong header', 'resource,impure\nCoal,1', 'nodes.header'],
    ['negative count', `${HEADER}\nCoal,0,-1,0,0,`, 'nodes.count'],
    ['fractional count', `${HEADER}\nCoal,0,1.5,0,0,`, 'nodes.count'],
    ['duplicate resource', `${HEADER}\nCoal,0,1,0,0,\nCoal,0,1,0,0,`, 'nodes.duplicate'],
    ['bad site rate', `${HEADER}\nCoal,1,0,0,0,-5`, 'nodes.siteRate'],
    ['missing column', `${HEADER}\nCoal,0,1,0`, 'nodes.columns'],
  ])('%s is an error', (_, text, code) => {
    expect(parse(text).errors).toContain(code);
  });
});
