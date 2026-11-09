import { z } from 'zod';

/**
 * How a setting's value is edited, derived from its zod schema, so the admin Settings page is
 * generated from the registry and a newly registered setting needs no UI work. Shapes the
 * descriptor can't express (a list of objects, a nullable object) fall back to `json`.
 */
export type InputSpec =
  | { kind: 'integer' | 'number'; min?: number; max?: number }
  | { kind: 'boolean' }
  | { kind: 'text'; pattern?: string }
  | { kind: 'enum'; options: string[] }
  /** Empty input means null. */
  | {
      kind: 'nullable';
      inner: Exclude<InputSpec, { kind: 'nullable' | 'list' | 'group' | 'json' }>;
    }
  /** Comma-separated entries. */
  | {
      kind: 'list';
      item: Exclude<InputSpec, { kind: 'nullable' | 'list' | 'group' | 'json' }>;
      minItems?: number;
    }
  | { kind: 'group'; fields: { name: string; spec: InputSpec }[] }
  | { kind: 'json' };

type Leaf = Exclude<InputSpec, { kind: 'nullable' | 'list' | 'group' | 'json' }>;

// zod 3 internals; `any` keeps this readable and every path ends in the `json` fallback.
/* eslint-disable @typescript-eslint/no-explicit-any */
const SAFE = Number.MAX_SAFE_INTEGER;

function leaf(def: any): Leaf | null {
  switch (def.typeName) {
    case 'ZodNumber': {
      const checks: any[] = def.checks;
      const spec: Leaf = { kind: checks.some((c) => c.kind === 'int') ? 'integer' : 'number' };
      for (const c of checks) {
        if (c.kind === 'min' && c.value > -SAFE) spec.min = c.value;
        if (c.kind === 'max' && c.value < SAFE) spec.max = c.value;
      }
      return spec;
    }
    case 'ZodBoolean':
      return { kind: 'boolean' };
    case 'ZodString': {
      const re = (def.checks as any[]).find((c) => c.kind === 'regex');
      return re ? { kind: 'text', pattern: re.regex.source } : { kind: 'text' };
    }
    case 'ZodEnum':
      return { kind: 'enum', options: [...def.values] };
    default:
      return null;
  }
}

export function describeInput(schema: z.ZodTypeAny): InputSpec {
  const def = (schema as any)._def;
  const plain = leaf(def);
  if (plain) return plain;
  if (def.typeName === 'ZodNullable') {
    const inner = leaf(def.innerType._def);
    return inner ? { kind: 'nullable', inner } : { kind: 'json' };
  }
  if (def.typeName === 'ZodArray') {
    const item = leaf(def.type._def);
    if (!item) return { kind: 'json' };
    const minItems: number | undefined = def.minLength?.value;
    return minItems === undefined ? { kind: 'list', item } : { kind: 'list', item, minItems };
  }
  if (def.typeName === 'ZodObject') {
    const shape = def.shape() as Record<string, z.ZodTypeAny>;
    return {
      kind: 'group',
      fields: Object.entries(shape).map(([name, s]) => ({ name, spec: describeInput(s) })),
    };
  }
  return { kind: 'json' };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** What a form holds while the owner types: strings for inputs, booleans for switches, nested for groups. */
export type Draft = string | boolean | { [field: string]: Draft };

const text = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

/** The editable form of a stored value. */
export function toDraft(spec: InputSpec, value: unknown): Draft {
  switch (spec.kind) {
    case 'boolean':
      return value === true;
    case 'group': {
      const obj = (value ?? {}) as Record<string, unknown>;
      return Object.fromEntries(spec.fields.map((f) => [f.name, toDraft(f.spec, obj[f.name])]));
    }
    case 'list':
      return Array.isArray(value) ? value.map(text).join(', ') : '';
    case 'json':
      return JSON.stringify(value, null, 2);
    default:
      return text(value);
  }
}

function scalar(spec: Leaf, raw: string): unknown {
  switch (spec.kind) {
    case 'integer':
    case 'number': {
      const s = raw.trim().replace(',', '.');
      // an empty or non-numeric entry becomes NaN, which the number schema refuses as "required"
      return s === '' ? Number.NaN : Number(s);
    }
    case 'text':
    case 'enum':
      return raw.trim();
    case 'boolean':
      return raw === 'true';
  }
}

/** The value a draft stands for, ready for the schema. Unparseable input stays invalid so the schema names the problem. */
export function fromDraft(spec: InputSpec, draft: Draft): unknown {
  switch (spec.kind) {
    case 'boolean':
      return draft === true;
    case 'nullable': {
      const raw = String(draft).trim();
      return raw === '' ? null : scalar(spec.inner, raw);
    }
    case 'group': {
      const d = draft as { [field: string]: Draft };
      return Object.fromEntries(
        spec.fields.map((f) => [f.name, fromDraft(f.spec, d[f.name] ?? '')]),
      );
    }
    case 'list':
      return String(draft)
        .split(/[,;\s]+/)
        .filter(Boolean)
        .map((part) => scalar(spec.item, part));
    case 'json':
      try {
        return JSON.parse(String(draft));
      } catch {
        return undefined;
      }
    default:
      return scalar(spec, String(draft));
  }
}

/** A refused value, language-free: the admin turns `code` (+ `min`/`max`) into RU or UZ text. */
export const settingIssueSchema = z.object({
  path: z.array(z.string()),
  code: z.enum([
    'required',
    'not_integer',
    'too_small',
    'too_big',
    'too_few_items',
    'invalid_format',
    'invalid_option',
    'invalid',
  ]),
  min: z.number().optional(),
  max: z.number().optional(),
  /** For too_small / too_big: the bound itself is not allowed ("more than 10"). */
  exclusive: z.boolean().optional(),
});
export type SettingIssue = z.infer<typeof settingIssueSchema>;

/** One mapping, used by the API (the refusal it sends) and the admin form (its own check before sending). */
export function toSettingIssues(error: z.ZodError): SettingIssue[] {
  return error.issues.map((i): SettingIssue => {
    const path = i.path.map(String);
    switch (i.code) {
      case 'invalid_type':
        if (i.expected === 'integer') return { path, code: 'not_integer' };
        return {
          path,
          code: i.received === 'undefined' || i.received === 'nan' ? 'required' : 'invalid',
        };
      case 'too_small':
        return i.type === 'array'
          ? { path, code: 'too_few_items', min: Number(i.minimum) }
          : { path, code: 'too_small', min: Number(i.minimum), exclusive: !i.inclusive };
      case 'too_big':
        return { path, code: 'too_big', max: Number(i.maximum), exclusive: !i.inclusive };
      case 'invalid_string':
        return { path, code: 'invalid_format' };
      case 'invalid_enum_value':
        return { path, code: 'invalid_option' };
      default:
        return { path, code: 'invalid' };
    }
  });
}
