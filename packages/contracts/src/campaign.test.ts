import { expect, it } from 'vitest';
import {
  CAMPAIGN_CODE_PATTERN,
  campaignCodeOf,
  campaignStartParam,
  isStartTarget,
} from './constants';

it('reads a launch parameter as a campaign code exactly when the code pattern accepts it', () => {
  for (const code of [
    'abc',
    'insta-nov',
    'A_b-9',
    'x'.repeat(40),
    'ab',
    'x'.repeat(41),
    'a b',
    '../x',
    '',
  ]) {
    expect(campaignCodeOf(campaignStartParam(code))).toBe(
      CAMPAIGN_CODE_PATTERN.test(code) ? code : null,
    );
  }
});

it('a campaign link is not a target a link, banner or broadcast may point at', () => {
  expect(isStartTarget('l_insta-nov')).toBe(false);
  expect(isStartTarget('p_tygar')).toBe(true);
  expect(isStartTarget('builder')).toBe(true);
});
