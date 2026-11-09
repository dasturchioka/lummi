import { contract } from '@lummi/contracts';
import { Controller, Inject, UseGuards } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { SettingsService } from '../settings/settings.service';
import { EDGES, ENV } from '../tokens';
import type { Edges } from '../edges';
import type { Env } from '../env';
import { CustomersService } from './customers.service';
import { InitDataError, verifyInitData } from './init-data';
import { SessionCustomerId, SessionGuard } from './session.guard';
import { SessionService } from './session.service';

@Controller()
export class AuthController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(CustomersService) private readonly customers: CustomersService,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  @TsRestHandler(contract.auth.telegram)
  telegram() {
    return tsRestHandler(contract.auth.telegram, async ({ body }) => {
      let verified;
      try {
        verified = verifyInitData(body.initData, {
          botToken: this.env.BOT_TOKEN,
          now: this.edges.clock.now(),
          maxAgeSeconds: await this.settings.get('auth.initDataMaxAgeSeconds'),
          maxFutureSkewSeconds: await this.settings.get('auth.initDataMaxFutureSkewSeconds'),
        });
      } catch (e) {
        if (!(e instanceof InitDataError)) throw e;
        const expired = e.reason === 'stale' || e.reason === 'future';
        return {
          status: 401 as const,
          body: { code: expired ? ('expired_init_data' as const) : ('invalid_init_data' as const) },
        };
      }
      const customer = await this.customers.signIn(verified.user);
      const session = await this.sessions.issue(customer.id);
      return {
        status: 200 as const,
        body: { token: session.token, expiresAt: session.expiresAt.toISOString() },
      };
    });
  }

  /** Identity comes only from the Bearer session; expiry comes from the clock. */
  @TsRestHandler(contract.auth.refresh)
  @UseGuards(SessionGuard)
  refresh(@SessionCustomerId() customerId: number) {
    return tsRestHandler(contract.auth.refresh, async () => {
      if (!(await this.customers.getById(customerId))) {
        return { status: 401 as const, body: { code: 'unauthorized' as const } };
      }
      const session = await this.sessions.issue(customerId);
      return {
        status: 200 as const,
        body: { token: session.token, expiresAt: session.expiresAt.toISOString() },
      };
    });
  }
}
