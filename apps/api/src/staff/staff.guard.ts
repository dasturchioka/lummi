import type { StaffRow } from '@lummi/db';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import {
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { readCookie } from './cookie';
import { STAFF_COOKIE, StaffSessionService } from './staff-session.service';

export type StaffRequest = Request & { staff?: StaffRow; staffToken?: string };

const DURING_PASSWORD_CHANGE = 'lummi:allowedDuringPasswordChange';

/**
 * Marks an endpoint a member signed in with a temporary password may still call (who am I, the
 * password policy, the change itself). Everything else answers 403 `password_change_required`.
 */
export const AllowedDuringPasswordChange = () => SetMetadata(DURING_PASSWORD_CHANGE, true);

/**
 * Any active staff member with a live session cookie. A member whose password is temporary
 * (ADR 0038) reaches only the endpoints marked `@AllowedDuringPasswordChange()`.
 */
@Injectable()
export class StaffGuard implements CanActivate {
  constructor(
    @Inject(StaffSessionService) private readonly sessions: StaffSessionService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<StaffRequest>();
    const token = readCookie(req.headers.cookie, STAFF_COOKIE);
    const member = token ? await this.sessions.resolve(token) : null;
    if (!member || !token) throw new UnauthorizedException({ code: 'unauthorized' });
    if (
      member.mustChangePassword &&
      !this.reflector.getAllAndOverride<boolean>(DURING_PASSWORD_CHANGE, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      throw new ForbiddenException({ code: 'password_change_required' });
    }
    req.staff = member;
    req.staffToken = token;
    return true;
  }
}

/** The owner's role, one spelling for every owner-only check (guards, owner-only figures). */
export const isOwner = (member: Pick<StaffRow, 'role'>): boolean => member.role === 'owner';

/**
 * Owner-only endpoints (card details, settings, promo codes, campaign links, broadcasts, staff):
 * `@UseGuards(StaffGuard, OwnerGuard)`. Order matters; OwnerGuard reads what StaffGuard resolved.
 */
@Injectable()
export class OwnerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const member = context.switchToHttp().getRequest<StaffRequest>().staff;
    if (!member) throw new UnauthorizedException({ code: 'unauthorized' });
    if (!isOwner(member)) throw new ForbiddenException({ code: 'forbidden' });
    return true;
  }
}

/** The only source of a staff identity in a handler: the verified session, never the client. */
export const CurrentStaff = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): StaffRow => {
    return ctx.switchToHttp().getRequest<StaffRequest>().staff as StaffRow;
  },
);

/** The session token StaffGuard verified (a password change keeps this session alive). */
export const CurrentStaffToken = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    return ctx.switchToHttp().getRequest<StaffRequest>().staffToken as string;
  },
);
