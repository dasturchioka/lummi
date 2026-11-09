import { describe, expect, it } from 'vitest';
import { clientContract } from './client';
import { contract } from './contract';

type Node = Record<string, unknown>;
const isRoute = (n: unknown): n is { method: string; path: string; responses: Node } =>
  typeof n === 'object' && n !== null && 'method' in n && 'path' in n;

function routes(
  tree: Node,
  prefix = '',
): Record<string, { method: string; path: string; statuses: string[] }> {
  return Object.entries(tree).reduce(
    (acc, [k, v]) => {
      const name = prefix + k;
      if (isRoute(v))
        acc[name] = { method: v.method, path: v.path, statuses: Object.keys(v.responses).sort() };
      else Object.assign(acc, routes(v as Node, `${name}.`));
      return acc;
    },
    {} as ReturnType<typeof routes>,
  );
}

describe('client contract', () => {
  it('has the same routes, methods, paths and statuses as the server contract', () => {
    expect(routes(clientContract as unknown as Node)).toEqual(routes(contract as unknown as Node));
  });
  it('carries no zod at runtime', () => {
    expect(JSON.stringify(clientContract)).not.toContain('_def');
  });
});
