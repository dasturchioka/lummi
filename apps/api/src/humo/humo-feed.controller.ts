import { internalContract } from '@lummi/contracts';
import { Controller, Inject, UseGuards } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { InternalGuard } from '../internal/internal.guard';
import { HumoFeedService } from './humo-feed.service';

/** What the userbot calls (ADR 0014, ADR 0015). Internal network and shared secret only. */
@Controller()
@UseGuards(InternalGuard)
export class HumoFeedController {
  constructor(@Inject(HumoFeedService) private readonly feed: HumoFeedService) {}

  @TsRestHandler(internalContract.humoMessage)
  humoMessage() {
    return tsRestHandler(internalContract.humoMessage, async ({ body }) => ({
      status: 200 as const,
      body: await this.feed.intake(body.messageId, body.text),
    }));
  }

  @TsRestHandler(internalContract.humoLastMessageId)
  humoLastMessageId() {
    return tsRestHandler(internalContract.humoLastMessageId, async () => ({
      status: 200 as const,
      body: { messageId: await this.feed.lastMessageId() },
    }));
  }

  @TsRestHandler(internalContract.userbotHeartbeat)
  userbotHeartbeat() {
    return tsRestHandler(internalContract.userbotHeartbeat, async () => {
      await this.feed.userbotHeartbeat();
      return { status: 200 as const, body: { ok: true as const } };
    });
  }
}
