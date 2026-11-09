import type { UserFromGetMe } from 'grammy/types';
import type { Db } from '@lummi/db';
import { Module, type DynamicModule } from '@nestjs/common';
import { AdminAuthController } from './admin/admin-auth.controller';
import { AdminLoginService } from './admin/admin-login.service';
import { CatalogAdminController, OnHandController } from './admin/catalog-admin.controller';
import { CatalogAdminService } from './admin/catalog-admin.service';
import { StaffController } from './admin/staff.controller';
import { OwnerGuard, StaffGuard } from './staff/staff.guard';
import { StaffSessionService } from './staff/staff-session.service';
import { StaffService } from './staff/staff.service';
import { BtsAdminController } from './delivery/bts-admin.controller';
import { BtsAdminService } from './delivery/bts-admin.service';
import { DeliveryController } from './delivery/delivery.controller';
import { DeliveryService } from './delivery/delivery.service';
import { CatalogController } from './catalog/catalog.controller';
import { CatalogService } from './catalog/catalog.service';
import { MediaController } from './catalog/media.controller';
import { AuditService } from './audit/audit.service';
import { AuthController } from './auth/auth.controller';
import { CustomersService } from './auth/customers.service';
import { SessionGuard } from './auth/session.guard';
import { SessionService } from './auth/session.service';
import type { Edges } from './edges';
import type { Env } from './env';
import { AlertService } from './outbox/alert.service';
import { OutboxService } from './outbox/outbox.service';
import { BOT_INFO, BotService } from './bot/bot.service';
import { WebhookController } from './bot/webhook.controller';
import { MeController } from './me/me.controller';
import { CreditEvents } from './humo/credit-events';
import { HumoFeedController } from './humo/humo-feed.controller';
import { HumoFeedService } from './humo/humo-feed.service';
import { InternalGuard } from './internal/internal.guard';
import { WorkerRuntime } from './worker/runtime';
import { SettingsService } from './settings/settings.service';
import { DB, EDGES, ENV } from './tokens';

export interface AppDeps {
  env: Env;
  db: Db;
  edges: Edges;
  /** Bot identity when known up front (tests); otherwise BotService.start() fetches it. */
  botInfo?: UserFromGetMe;
}

@Module({})
export class AppModule {
  /** Dependencies are injected, so tests build the same app with a test db and fake edges. */
  static register(deps: AppDeps): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        AuthController,
        MeController,
        CatalogController,
        MediaController,
        WebhookController,
        AdminAuthController,
        StaffController,
        CatalogAdminController,
        OnHandController,
        DeliveryController,
        BtsAdminController,
        HumoFeedController,
      ],
      providers: [
        { provide: ENV, useValue: deps.env },
        { provide: DB, useValue: deps.db },
        { provide: EDGES, useValue: deps.edges },
        { provide: BOT_INFO, useValue: deps.botInfo },
        AuditService,
        OutboxService,
        AlertService,
        BotService,
        WorkerRuntime,
        SettingsService,
        CatalogService,
        CatalogAdminService,
        CustomersService,
        DeliveryService,
        BtsAdminService,
        SessionService,
        SessionGuard,
        StaffService,
        AdminLoginService,
        StaffSessionService,
        StaffGuard,
        OwnerGuard,
        InternalGuard,
        CreditEvents,
        HumoFeedService,
      ],
      exports: [
        CreditEvents,
        HumoFeedService,
        SettingsService,
        AuditService,
        OutboxService,
        AlertService,
        BotService,
        WorkerRuntime,
        StaffService,
        DeliveryService,
      ],
    };
  }
}
