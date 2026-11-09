import type { StaffRow } from '@lummi/db';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import type { Request } from 'express';
import { readCookie } from './cookie';
import { STAFF_COOKIE, StaffSessionService } from './staff-session.service';

export type StaffRequest = Request & { staff?: StaffRow };

/** Any active staff member with a live session cookie. */
@Injectable()
export class StaffGuard implements CanActivate {
  constructor(@Inject(StaffSessionService) private readonly sessions: StaffSessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<StaffRequest>();
    const token = readCookie(req.headers.cookie, STAFF_COOKIE);
    const member = token ? await this.sessions.resolve(token) : null;
    if (!member) throw new UnauthorizedException({ code: 'unauthorized' });
    req.staff = member;
    return true;
  }
}

/**
 * Owner-only endpoints (card details, settings, promo codes, campaign links, broadcasts, staff):
 * `@UseGuards(StaffGuard, OwnerGuard)`. Order matters; OwnerGuard reads what StaffGuard resolved.
 */
@Injectable()
export class OwnerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const member = context.switchToHttp().getRequest<StaffRequest>().staff;
    if (!member) throw new UnauthorizedException({ code: 'unauthorized' });
    if (member.role !== 'owner') throw new ForbiddenException({ code: 'forbidden' });
    return true;
  }
}

/** The only source of a staff identity in a handler: the verified session, never the client. */
export const CurrentStaff = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): StaffRow => {
    return ctx.switchToHttp().getRequest<StaffRequest>().staff as StaffRow;
  },
);
