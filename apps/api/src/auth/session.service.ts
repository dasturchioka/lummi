import { Inject, Injectable } from '@nestjs/common';
import { jwtVerify, SignJWT } from 'jose';
import { SettingsService } from '../settings/settings.service';
import { EDGES, ENV } from '../tokens';
import type { Env } from '../env';
import type { Edges } from '../edges';

@Injectable()
export class SessionService {
  private readonly key: Uint8Array;

  constructor(
    @Inject(ENV) env: Env,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {
    this.key = new TextEncoder().encode(env.SESSION_SECRET);
  }

  async issue(customerId: number): Promise<{ token: string; expiresAt: Date }> {
    const ttl = await this.settings.get('auth.sessionTtlSeconds');
    const now = this.edges.clock.now();
    const expiresAt = new Date(now.getTime() + ttl * 1000);
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(String(customerId))
      .setIssuedAt(Math.floor(now.getTime() / 1000))
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.key);
    return { token, expiresAt };
  }

  /** Returns the customer id, or null for a missing, forged or expired token. */
  async verify(token: string): Promise<number | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: ['HS256'],
        currentDate: this.edges.clock.now(),
      });
      const id = Number(payload.sub);
      return Number.isSafeInteger(id) && id > 0 ? id : null;
    } catch {
      return null;
    }
  }
}
