import type { UserFromGetMe } from 'grammy/types';
import type { Db } from '@lummi/db';
import { Module, type DynamicModule } from '@nestjs/common';
import { AdminAuthController } from './admin/admin-auth.controller';
import { AdminOrdersController } from './admin-orders/admin-orders.controller';
import { AdminOrdersService } from './admin-orders/admin-orders.service';
import { AdminLoginService } from './admin/admin-login.service';
import { AuditController } from './admin/audit.controller';
import { CatalogAdminController, OnHandController } from './admin/catalog-admin.controller';
import { CatalogImportController } from './admin/catalog-import.controller';
import { CatalogAdminService } from './admin/catalog-admin.service';
import { CatalogImportService } from './catalog-import/catalog-import.service';
import { BroadcastController } from './broadcast/broadcast.controller';
import { BroadcastService } from './broadcast/broadcast.service';
import { SettingsController } from './admin/settings.controller';
import { StaffController } from './admin/staff.controller';
import { ProfileController } from './admin/profile.controller';
import { AuditQueryService } from './audit/audit-query.service';
import { OwnerGuard, StaffGuard } from './staff/staff.guard';
import { StaffSessionService } from './staff/staff-session.service';
import { LoginThrottle } from './staff/login-throttle';
import { StaffTelegramLinks } from './staff/telegram-link.service';
import { StaffService } from './staff/staff.service';
import { BtsAdminController } from './delivery/bts-admin.controller';
import { BtsAdminService } from './delivery/bts-admin.service';
import { DeliveryController } from './delivery/delivery.controller';
import { DeliveryService } from './delivery/delivery.service';
import { CartController } from './cart/cart.controller';
import { CartService } from './cart/cart.service';
import { OrdersController } from './orders/orders.controller';
import { ShopCardController } from './payment/shop-card.controller';
import { PaymentConfirmation } from './payment/payment-confirmation';
import { PaymentMatching } from './payment/payment-matching';
import { PaymentNotFound } from './payment/payment-not-found';
import { PaymentPauses } from './payment/payment-pauses';
import { ShopCardService } from './payment/shop-card.service';
import { ReceiptRejection } from './payment/receipt-rejection';
import { ReceiptsAdminController, ReceiptsController } from './receipts/receipts.controller';
import { ReceiptsService } from './receipts/receipts.service';
import { OrdersService } from './orders/orders.service';
import { DiscountSourceHooks } from './order-status/discount-sources';
import { BirthdayService } from './birthday/birthday.service';
import { BirthdayCouponJob } from './birthday/birthday-job';
import { DiscountsController } from './birthday/discounts.controller';
import { OrderStatusService } from './order-status/order-status.service';
import { ReserveSweeps } from './order-status/reserve-sweeps';
import { UpgradeRightReminders } from './upgrade-rights/upgrade-right-reminders';
import { CatalogController } from './catalog/catalog.controller';
import { CatalogService } from './catalog/catalog.service';
import { SetsAdminController } from './admin/sets-admin.controller';
import { CustomersAdminController } from './admin/customers-admin.controller';
import { StockAdminController } from './admin/stock-admin.controller';
import { CustomersAdminService } from './admin/customers-admin.service';
import { StockAdminService } from './admin/stock-admin.service';
import { SetsAdminService } from './admin/sets-admin.service';
import { ReviewsAdminController, ReviewsController } from './reviews/reviews.controller';
import { ReviewsBot } from './reviews/reviews-bot';
import { ReviewsService } from './reviews/reviews.service';
import { FavouritesController } from './favourites/favourites.controller';
import { FavouritesService } from './favourites/favourites.service';
import { SetsController } from './sets/sets.controller';
import { SetsService } from './sets/sets.service';
import { SearchService } from './search/search.service';
import { HealthController } from './health/health.controller';
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
import { BotReceipts } from './bot/bot-receipts.service';
import { OrderCards } from './orders-group/order-cards';
import { Refunds } from './refunds/refunds';
import { OrdersGroupBot } from './orders-group/orders-group-bot';
import { WebhookController } from './bot/webhook.controller';
import { MeController } from './me/me.controller';
import { CreditEvents } from './humo/credit-events';
import { HumoFeedController } from './humo/humo-feed.controller';
import { HumoFeedService } from './humo/humo-feed.service';
import { InternalGuard } from './internal/internal.guard';
import { WorkerRuntime } from './worker/runtime';
import { ContentAdminController, ContentController } from './content/content.controller';
import { ContentService } from './content/content.service';
import { CampaignsAdminController, CampaignsController } from './campaigns/campaigns.controller';
import { CampaignsService } from './campaigns/campaigns.service';
import { PromoAdminController } from './promo/promo-admin.controller';
import { PromoAdminService } from './promo/promo-admin.service';
import { ReportsController } from './reports/reports.controller';
import { SalesReports } from './reports/sales-reports.service';
import { SettingsService } from './settings/settings.service';
import { DB, EDGES, ENV } from './tokens';

export interface AppDeps {
  env: Env;
  db: Db;
  edges: Edges;
  /** Bot identity when known up front (tests); otherwise BotService.start() fetches it. */
  botInfo?: UserFromGetMe;
}

import { ErrorTracker } from './ops/error-tracker.service';
import { BackupWatch } from './ops/backup-watch.service';
import { OpsNotifier } from './ops/ops-notifier.service';
import { OpsController } from './ops/ops.controller';
import { WorkerWatch } from './ops/worker-watch.service';

@Module({})
export class AppModule {
  /** Dependencies are injected, so tests build the same app with a test db and fake edges. */
  static register(deps: AppDeps): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        HealthController,
        AuthController,
        MeController,
        CatalogController,
        CartController,
        SetsController,
        FavouritesController,
        ReviewsController,
        ReviewsAdminController,
        OrdersController,
        ReceiptsController,
        ReceiptsAdminController,
        ShopCardController,
        MediaController,
        WebhookController,
        AdminAuthController,
        StaffController,
        ProfileController,
        SettingsController,
        AuditController,
        CatalogAdminController,
        CatalogImportController,
        OnHandController,
        SetsAdminController,
        StockAdminController,
        CustomersAdminController,
        ContentController,
        ContentAdminController,
        DeliveryController,
        BtsAdminController,
        HumoFeedController,
        OpsController,
        BroadcastController,
        PromoAdminController,
        AdminOrdersController,
        CampaignsController,
        CampaignsAdminController,
        DiscountsController,
        ReportsController,
      ],
      providers: [
        { provide: ENV, useValue: deps.env },
        { provide: DB, useValue: deps.db },
        { provide: EDGES, useValue: deps.edges },
        { provide: BOT_INFO, useValue: deps.botInfo },
        AuditService,
        AuditQueryService,
        OutboxService,
        AlertService,
        BotService,
        BotReceipts,
        WorkerRuntime,
        SettingsService,
        CatalogService,
        CartService,
        SetsService,
        FavouritesService,
        ReviewsService,
        ReviewsBot,
        OrdersService,
        ReceiptsService,
        ShopCardService,
        PaymentConfirmation,
        PaymentMatching,
        PaymentNotFound,
        PaymentPauses,
        OrderStatusService,
        OrderCards,
        OrdersGroupBot,
        DiscountSourceHooks,
        ReserveSweeps,
        UpgradeRightReminders,
        CatalogAdminService,
        CatalogImportService,
        SetsAdminService,
        StockAdminService,
        CustomersAdminService,
        ContentService,
        SearchService,
        CustomersService,
        DeliveryService,
        BtsAdminService,
        SessionService,
        SessionGuard,
        StaffService,
        AdminLoginService,
        StaffSessionService,
        LoginThrottle,
        StaffTelegramLinks,
        StaffGuard,
        OwnerGuard,
        InternalGuard,
        CreditEvents,
        HumoFeedService,
        BroadcastService,
        PromoAdminService,
        ReceiptRejection,
        AdminOrdersService,
        Refunds,
        CampaignsService,
        SalesReports,
        BirthdayService,
        BirthdayCouponJob,
        ErrorTracker,
        OpsNotifier,
        WorkerWatch,
        BackupWatch,
      ],
      exports: [
        CreditEvents,
        OrderStatusService,
        PaymentConfirmation,
        // the one reject door: the orders group (#37) rejects through it too
        ReceiptRejection,
        HumoFeedService,
        SettingsService,
        AuditService,
        OutboxService,
        AlertService,
        BotService,
        WorkerRuntime,
        StaffService,
        DeliveryService,
        ErrorTracker,
        WorkerWatch,
      ],
    };
  }
}
