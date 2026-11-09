import { INTERNAL_SECRET_HEADER } from '@lummi/contracts';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { BlockList, isIPv4 } from 'node:net';
import type { Request } from 'express';
import type { Env } from '../env';
import { ENV } from '../tokens';

/** Headers a reverse proxy adds; their presence means the request came in from outside. */
const PROXY_HEADERS = ['x-forwarded-for', 'forwarded', 'x-real-ip'] as const;

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

/**
 * Internal endpoints (ADR 0031) answer only a caller on the internal network holding the shared
 * secret. No secret configured: 404, as if the route did not exist. A source address outside
 * INTERNAL_ALLOWED_CIDRS, or any request relayed by the public reverse proxy (which runs on the
 * same network and adds X-Forwarded-For), is refused with 403. A missing or wrong secret is 401.
 * The secret is compared as SHA-256 digests in constant time, so neither its content nor its
 * length leaks through timing.
 */
@Injectable()
export class InternalGuard implements CanActivate {
  private readonly allowed = new BlockList();
  private readonly secret: Buffer | null;

  constructor(@Inject(ENV) env: Env) {
    for (const c of env.INTERNAL_ALLOWED_CIDRS)
      this.allowed.addSubnet(c.address, c.prefix, c.family);
    this.secret = env.INTERNAL_API_SECRET ? digest(env.INTERNAL_API_SECRET) : null;
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (!this.secret) throw new NotFoundException();
    if (!this.fromInternalNetwork(req)) throw new ForbiddenException({ code: 'forbidden' });
    const given = req.headers[INTERNAL_SECRET_HEADER];
    if (typeof given !== 'string' || !timingSafeEqual(digest(given), this.secret)) {
      throw new UnauthorizedException({ code: 'unauthorized' });
    }
    return true;
  }

  private fromInternalNetwork(req: Request): boolean {
    if (PROXY_HEADERS.some((h) => req.headers[h] !== undefined)) return false;
    let address = req.socket.remoteAddress;
    if (!address) return false;
    // A dual-stack socket reports IPv4 peers as ::ffff:a.b.c.d.
    const mapped = address.toLowerCase().startsWith('::ffff:') ? address.slice(7) : null;
    if (mapped && isIPv4(mapped)) address = mapped;
    return this.allowed.check(address, isIPv4(address) ? 'ipv4' : 'ipv6');
  }
}
