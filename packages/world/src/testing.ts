/**
 * Test helpers: compact world construction. Not exported from the package
 * entry; tests import it directly.
 */
import type { ItemRate } from '@sps/solver';
import {
  createFactory,
  createWorld,
  type Factory,
  type Group,
  type Link,
  type World,
} from './document';

export interface FactorySpec {
  id: string;
  targets?: ItemRate[];
  group?: string;
  resources?: Factory['resources'];
  request?: Partial<Factory['request']>;
  unassignedImports?: Factory['unassignedImports'];
}

export function pull(id: string, from: string, to: string, item: string): Link {
  return { id, from, to, item, mode: { kind: 'pull' } };
}

export function fixed(id: string, from: string, to: string, item: string, rate: number): Link {
  return { id, from, to, item, mode: { kind: 'fixed', rate } };
}

export function buildWorld(
  factories: FactorySpec[],
  links: Link[] = [],
  groups: Group[] = [],
): World {
  const w = createWorld('test');
  w.factories = factories.map((s) => {
    const f = createFactory(s.id, s.id.toUpperCase());
    f.request = { ...f.request, ...s.request, targets: [...(s.targets ?? [])] };
    if (s.group !== undefined) f.groupId = s.group;
    if (s.resources !== undefined) f.resources = s.resources;
    if (s.unassignedImports) f.unassignedImports = s.unassignedImports;
    return f;
  });
  w.links = links;
  w.groups = groups;
  return w;
}
