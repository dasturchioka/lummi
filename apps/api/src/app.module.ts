import type { Db } from '@lummi/db';
import { Module, type DynamicModule } from '@nestjs/common';
import { AdminAuthController } from './admin/admin-auth.controller';
import { AdminLoginService } from './admin/admin-login.service';
import { StaffController } from './admin/staff.controller';
import { OwnerGuard, StaffGuard } from './staff/staff.guard';
import { StaffSessionService } from './staff/staff-session.service';
import { StaffService } from './staff/staff.service';
import { AuditService } from './audit/audit.service';
import { AuthController } from './auth/auth.controller';
import { CustomersService } from './auth/customers.service';
import { SessionGuard } from './auth/session.guard';
import { SessionService } from './auth/session.service';
import type { Edges } from './edges';
import type { Env } from './env';
import { MeController } from './me/me.controller';
import { SettingsService } from './settings/settings.service';
import { DB, EDGES, ENV } from './tokens';

export interface AppDeps {
  env: Env;
  db: Db;
  edges: Edges;
}

@Module({})
export class AppModule {
  /** Dependencies are injected, so tests build the same app with a test db and fake edges. */
  static register(deps: AppDeps): DynamicModule {
    return {
      module: AppModule,
      controllers: [AuthController, MeController, AdminAuthController, StaffController],
      providers: [
        { provide: ENV, useValue: deps.env },
        { provide: DB, useValue: deps.db },
        { provide: EDGES, useValue: deps.edges },
        AuditService,
        SettingsService,
        CustomersService,
        SessionService,
        SessionGuard,
        StaffService,
        AdminLoginService,
        StaffSessionService,
        StaffGuard,
        OwnerGuard,
      ],
      exports: [SettingsService, AuditService, StaffService],
    };
  }
}
