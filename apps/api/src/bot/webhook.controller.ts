import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Update } from 'grammy/types';
import type { Env } from '../env';
import { ENV } from '../tokens';
import { BotService } from './bot.service';

@Controller()
export class WebhookController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(BotService) private readonly bot: BotService,
  ) {}

  /** The URL is not a secret; the header Telegram echoes from setWebhook is. */
  @Post('telegram/webhook')
  @HttpCode(200)
  async receive(
    @Headers('x-telegram-bot-api-secret-token') given: string | undefined,
    @Body() update: Update,
  ): Promise<{ ok: true }> {
    const expected = this.env.WEBHOOK_SECRET;
    if (!expected) throw new NotFoundException();
    const a = Buffer.from(given ?? '');
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException();
    await this.bot.handleUpdate(update);
    return { ok: true };
  }
}
