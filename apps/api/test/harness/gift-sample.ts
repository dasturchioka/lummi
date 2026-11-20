import { settings } from '@lummi/db';
import type { TestApp } from './test-app';

/**
 * Switches the first order's gift sample off (#79). Since stock is liquid (ADR 0043) the seed's
 * concentrate fills a 5 ml sample for every first order; tests about something else turn it off
 * so their orders hold only their own lines (the seed had no 5 ml bottles before).
 */
export async function giftSampleOff(t: TestApp): Promise<void> {
  await t.db
    .insert(settings)
    .values({ key: 'giftSample.enabled', value: false })
    .onConflictDoUpdate({ target: settings.key, set: { value: false } });
}
