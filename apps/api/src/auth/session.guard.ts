import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Inject, Injectable, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import { CustomersService } from './customers.service';
import { SessionService } from './session.service';

type AuthedRequest = Request & { customerId?: number };

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(CustomersService) private readonly customers: CustomersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const claim = token ? await this.sessions.verify(token) : null;
    if (!claim) throw new UnauthorizedException({ code: 'unauthorized' });
    // The row must still belong to the Telegram account the token was issued to (relink, ADR 0004).
    const customer = await this.customers.getById(claim.customerId);
    if (!customer || customer.telegramId !== claim.telegramId) {
      throw new UnauthorizedException({ code: 'unauthorized' });
    }
    req.customerId = customer.id;
    return true;
  }
}

/** The only source of a customer id in a handler: the verified session, never the client. */
export const SessionCustomerId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): number => {
    return ctx.switchToHttp().getRequest<AuthedRequest>().customerId as number;
  },
);
