// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { tokenValue } from '../../tokens-css';

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

it('index.html carries no colour of its own: it takes the page ground from tokens.css', () => {
  expect(html).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  expect(html).toContain('%GROUND_LIGHT%');
  expect(html).toContain('%GROUND_DARK%');
});

it('reads both themes from tokens.css', () => {
  expect(tokenValue(css, 'light', '--c-ground')).toMatch(/^#[0-9a-f]{6}$/i);
  expect(tokenValue(css, 'dark', '--c-ground')).toMatch(/^#[0-9a-f]{6}$/i);
  expect(tokenValue(css, 'dark', '--c-ground')).not.toBe(tokenValue(css, 'light', '--c-ground'));
});
