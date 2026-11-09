import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { describeInput, fromDraft, toDraft, toSettingIssues } from './setting-input';
import { settingDefinitions, settingKeys } from './settings';

describe('describeInput', () => {
  it('describes numbers with bounds, nullable ids, lists and groups', () => {
    expect(describeInput(z.number().int().min(1).max(9))).toEqual({
      kind: 'integer',
      min: 1,
      max: 9,
    });
    expect(describeInput(z.number().int().nullable())).toEqual({
      kind: 'nullable',
      inner: { kind: 'integer' },
    });
    expect(describeInput(z.array(z.number().int()).min(1))).toMatchObject({
      kind: 'list',
      minItems: 1,
    });
    expect(describeInput(z.object({ a: z.boolean() }))).toEqual({
      kind: 'group',
      fields: [{ name: 'a', spec: { kind: 'boolean' } }],
    });
    expect(describeInput(z.array(z.object({})))).toEqual({ kind: 'json' });
  });

  it('gives every registered setting a draft that round-trips to its stored value', () => {
    for (const key of settingKeys) {
      const def = settingDefinitions[key];
      const spec = describeInput(def.schema);
      expect(spec.kind, key).not.toBe('json');
      const back = fromDraft(spec, toDraft(spec, def.default));
      expect(def.schema.parse(back), key).toEqual(def.default);
    }
  });
});

describe('drafts and issues', () => {
  it('maps what the owner typed to refusals the form can word', () => {
    const schema = z.number().int().min(10).max(20);
    const spec = describeInput(schema);
    const issues = (raw: string) => {
      const r = schema.safeParse(fromDraft(spec, raw));
      return r.success ? [] : toSettingIssues(r.error);
    };
    expect(issues('')).toEqual([{ path: [], code: 'required' }]);
    expect(issues('5')).toEqual([{ path: [], code: 'too_small', min: 10, exclusive: false }]);
    expect(issues('25')).toEqual([{ path: [], code: 'too_big', max: 20, exclusive: false }]);
    expect(issues('12.5')).toEqual([{ path: [], code: 'not_integer' }]);
    expect(issues('15')).toEqual([]);
  });

  it('parses a comma list and refuses an empty one', () => {
    const schema = z.array(z.number().int().gt(10)).min(1);
    const spec = describeInput(schema);
    expect(fromDraft(spec, '30, 50')).toEqual([30, 50]);
    const r = schema.safeParse(fromDraft(spec, ''));
    expect(!r.success && toSettingIssues(r.error)[0]).toMatchObject({
      code: 'too_few_items',
      min: 1,
    });
  });
});
