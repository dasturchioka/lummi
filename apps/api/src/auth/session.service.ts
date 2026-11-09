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

  /** The token carries the Telegram id it was issued to, so a relinked customer's old account loses access. */
  async issue(customerId: number, telegramId: number): Promise<{ token: string; expiresAt: Date }> {
    const ttl = await this.settings.get('auth.sessionTtlSeconds');
    const now = this.edges.clock.now();
    const expiresAt = new Date(now.getTime() + ttl * 1000);
    const token = await new SignJWT({ tg: telegramId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(String(customerId))
      .setIssuedAt(Math.floor(now.getTime() / 1000))
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.key);
    return { token, expiresAt };
  }

  /** Returns the customer id and the Telegram id it was issued to, or null for a missing, forged or expired token. */
  async verify(token: string): Promise<{ customerId: number; telegramId: number } | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: ['HS256'],
        currentDate: this.edges.clock.now(),
      });
      const id = Number(payload.sub);
      const tg = payload.tg;
      if (!Number.isSafeInteger(id) || id <= 0) return null;
      if (typeof tg !== 'number' || !Number.isSafeInteger(tg)) return null;
      return { customerId: id, telegramId: tg };
    } catch {
      return null;
    }
  }
}
