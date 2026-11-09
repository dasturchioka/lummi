import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Inject, Injectable, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import { SessionService } from './session.service';

type AuthedRequest = Request & { customerId?: number };

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(SessionService) private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const customerId = token ? await this.sessions.verify(token) : null;
    if (!customerId) throw new UnauthorizedException({ code: 'unauthorized' });
    req.customerId = customerId;
    return true;
  }
}

/** The only source of a customer id in a handler: the verified session, never the client. */
export const SessionCustomerId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): number => {
    return ctx.switchToHttp().getRequest<AuthedRequest>().customerId as number;
  },
);
