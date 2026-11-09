import { z } from 'zod';

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
