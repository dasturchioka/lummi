import { contract, type CustomerDto } from '@lummi/contracts';
import type { CustomerRow } from '@lummi/db';
import { Controller, Inject, UseGuards } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { ContactError, verifyContactProof } from '../auth/contact-proof';
import { CustomersService } from '../auth/customers.service';
import { SessionCustomerId, SessionGuard } from '../auth/session.guard';
import { SessionService } from '../auth/session.service';
import type { Edges } from '../edges';
import { SettingsService } from '../settings/settings.service';
import { EDGES, ENV } from '../tokens';
import type { Env } from '../env';

function toDto(c: CustomerRow): CustomerDto {
  return {
    id: c.id,
    telegramId: c.telegramId,
    firstName: c.firstName,
    lastName: c.lastName,
    username: c.username,
    language: c.language,
    theme: c.theme,
    phone: c.phone,
    writeAccess: c.writeAccess,
  };
}

@Controller()
@UseGuards(SessionGuard)
export class MeController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(CustomersService) private readonly customers: CustomersService,
  ) {}

  @TsRestHandler(contract.me.get)
  get(@SessionCustomerId() customerId: number) {
    return tsRestHandler(contract.me.get, async () => {
      const c = await this.customers.getById(customerId);
      if (!c) return { status: 401 as const, body: { code: 'unauthorized' as const } };
      return { status: 200 as const, body: toDto(c) };
    });
  }

  @TsRestHandler(contract.me.updatePreferences)
  updatePreferences(@SessionCustomerId() customerId: number) {
    return tsRestHandler(contract.me.updatePreferences, async ({ body }) => {
      const c = await this.customers.updatePreferences(customerId, body);
      if (!c) return { status: 401 as const, body: { code: 'unauthorized' as const } };
      return { status: 200 as const, body: toDto(c) };
    });
  }

  /**
   * The phone comes only from the contact Telegram signed, and only when it is the signed-in
   * user's own (ADR 0004). Nothing in the body is a phone to trust.
   */
  @TsRestHandler(contract.me.shareContact)
  shareContact(@SessionCustomerId() customerId: number) {
    return tsRestHandler(contract.me.shareContact, async ({ body }) => {
      const me = await this.customers.getById(customerId);
      if (!me) return { status: 401 as const, body: { code: 'unauthorized' as const } };
      let phone: string;
      try {
        ({ phone } = verifyContactProof(body.proof, me.telegramId, {
          botToken: this.env.BOT_TOKEN,
          now: this.edges.clock.now(),
          maxAgeSeconds: await this.settings.get('auth.initDataMaxAgeSeconds'),
          maxFutureSkewSeconds: await this.settings.get('auth.initDataMaxFutureSkewSeconds'),
        }));
      } catch (e) {
        if (!(e instanceof ContactError)) throw e;
        if (e.reason === 'not_yours') {
          return { status: 403 as const, body: { code: 'contact_not_yours' as const } };
        }
        return {
          status: 400 as const,
          body: {
            code:
              e.reason === 'expired' ? ('expired_contact' as const) : ('invalid_contact' as const),
          },
        };
      }
      const done = await this.customers.setVerifiedPhone(customerId, phone);
      if (!done) return { status: 401 as const, body: { code: 'unauthorized' as const } };
      const session = done.relinkedTo === null ? null : await this.sessions.issue(done.customer.id);
      return {
        status: 200 as const,
        body: {
          customer: toDto(done.customer),
          session: session
            ? { token: session.token, expiresAt: session.expiresAt.toISOString() }
            : null,
        },
      };
    });
  }

  @TsRestHandler(contract.me.writeAccess)
  writeAccess(@SessionCustomerId() customerId: number) {
    return tsRestHandler(contract.me.writeAccess, async ({ body }) => {
      const c = await this.customers.recordWriteAccess(customerId, body.allowed);
      if (!c) return { status: 401 as const, body: { code: 'unauthorized' as const } };
      return { status: 200 as const, body: toDto(c) };
    });
  }
}
