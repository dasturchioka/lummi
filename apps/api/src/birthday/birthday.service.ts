import { BIRTH_YEAR_MIN, type MyDiscountsDto, type SetBirthDateBody } from '@lummi/contracts';
import { birthdayCoupons, customers, eq, type CustomerRow, type Db, type DbOrTx } from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { Edges } from '../edges';
import { readSettings } from '../settings/settings.service';
import { DB, EDGES } from '../tokens';
import { myUpgradeRights } from '../upgrade-rights/upgrade-rights';
import { activeBirthdayCoupons, readBirthdayRules, toCouponDto } from './birthday-coupons';
import { formatLocalDate, nextWindow, parseLocalDate, tashkentDay } from './birthday-dates';

export type SetBirthDateOutcome =
  | { kind: 'ok'; discounts: MyDiscountsDto }
  | { kind: 'error'; status: 401 | 403 | 409 | 422; code: BirthDateRefusal };

type BirthDateRefusal =
  'unauthorized' | 'phone_required' | 'already_set' | 'invalid_birth_date' | 'consent_required';

/** Before 1900, or a day after today in Tashkent: not a date of birth. */
export function isPlausibleBirthDate(birthDate: string, now: Date): boolean {
  return birthDate >= `${BIRTH_YEAR_MIN}-01-01` && birthDate <= formatLocalDate(tashkentDay(now));
}

/**
 * Stores the date of birth on a customer who has none (TZ §3.8: entered once; afterwards only staff
 * correct it), with consent when it is the first (TZ §3.6: «включая дату рождения»). Shared by
 * Profile and checkout; the caller has checked the date is plausible.
 */
export async function recordBirthDate(
  tx: DbOrTx,
  audit: AuditService,
  c: CustomerRow,
  birthDate: string,
  now: Date,
  via: 'profile' | 'checkout',
): Promise<void> {
  await tx
    .update(customers)
    .set({ birthDate, birthDateSetAt: now, updatedAt: now })
    .where(eq(customers.id, c.id));
  await audit.record(tx, {
    actor: { type: 'customer', id: c.id },
    action: 'customer.birth_date_set',
    targetType: 'customer',
    targetId: c.id,
    // the fact, not the date: the audit is read by staff, and a date of birth is personal data
    payload: { via, set: true },
  });
}

/** Profile «Мои скидки» (with the upgrade rights of #38) and the one-time date of birth (ticket #30). */
@Injectable()
export class BirthdayService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async setBirthDate(customerId: number, body: SetBirthDateBody): Promise<SetBirthDateOutcome> {
    return this.db.transaction(async (tx) => {
      const [c] = await tx
        .select()
        .from(customers)
        .where(eq(customers.id, customerId))
        .for('update');
      if (!c) return { kind: 'error', status: 401, code: 'unauthorized' } as const;
      if (!c.phone) return { kind: 'error', status: 403, code: 'phone_required' } as const;
      if (c.birthDate !== null) return { kind: 'error', status: 409, code: 'already_set' } as const;
      const now = this.edges.clock.now();
      if (!isPlausibleBirthDate(body.birthDate, now))
        return { kind: 'error', status: 422, code: 'invalid_birth_date' } as const;
      if (c.dataConsentAt === null && !body.consent)
        return { kind: 'error', status: 422, code: 'consent_required' } as const;

      await recordBirthDate(tx, this.audit, c, body.birthDate, now, 'profile');
      if (c.dataConsentAt === null) {
        await tx.update(customers).set({ dataConsentAt: now }).where(eq(customers.id, c.id));
        await this.audit.record(tx, {
          actor: { type: 'customer', id: c.id },
          action: 'customer.data_consent_given',
          targetType: 'customer',
          targetId: c.id,
          payload: { via: 'birth_date' },
        });
      }
      return { kind: 'ok', discounts: await this.discountsIn(tx, c.id, now) } as const;
    });
  }

  async discounts(customerId: number): Promise<MyDiscountsDto | null> {
    const [c] = await this.db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.id, customerId));
    if (!c) return null;
    return this.discountsIn(this.db, customerId, this.edges.clock.now());
  }

  private async discountsIn(tx: DbOrTx, customerId: number, now: Date): Promise<MyDiscountsDto> {
    const [c] = await tx.select().from(customers).where(eq(customers.id, customerId));
    if (!c) throw new Error(`customer ${customerId} vanished`);
    const settings = await readSettings(tx, ['birthday.percent', 'birthday.daysBefore']);
    const active = await activeBirthdayCoupons(tx, customerId, now);
    let next: MyDiscountsDto['nextBirthdayCoupon'] = null;
    if (active.length === 0 && c.birthDate !== null && c.birthDateSetAt !== null) {
      const issued = await tx
        .select({ year: birthdayCoupons.birthdayYear })
        .from(birthdayCoupons)
        .where(eq(birthdayCoupons.customerId, customerId));
      const w = nextWindow(
        parseLocalDate(c.birthDate),
        c.birthDateSetAt,
        now,
        await readBirthdayRules(tx),
        issued.map((r) => r.year),
      );
      if (w) next = { opensOn: formatLocalDate(w.firstDay), percent: settings['birthday.percent'] };
    }
    return {
      birthDate: c.birthDate,
      birthdayCoupons: active.map((coupon) => toCouponDto(coupon, now)),
      upgradeRights: await myUpgradeRights(tx, customerId, now),
      nextBirthdayCoupon: next,
      birthdayPercent: settings['birthday.percent'],
      birthdayDaysBefore: settings['birthday.daysBefore'],
      needsConsent: c.dataConsentAt === null,
    };
  }
}
