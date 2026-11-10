import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { CATALOG_IMPORT_MIME, MAX_PHOTO_BYTES } from '@lummi/contracts';
import { AppModule, type AppDeps } from './app.module';
import { PinoLogger } from './logging/pino-logger';
import { SafeExceptionFilter } from './logging/safe-exception.filter';

export type { AppDeps };

export async function createApp(deps: AppDeps): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(deps), {
    logger: deps.env.NODE_ENV === 'test' ? false : new PinoLogger('api'),
  });
  // Photo uploads are raw image bytes (admin catalog); the cap is enforced again in the handler.
  app.useBodyParser('raw', {
    type: ['image/jpeg', 'image/png', 'image/webp'],
    limit: MAX_PHOTO_BYTES + 1024,
  });
  // The catalog workbook is raw xlsx bytes; the owner-set size cap (a setting) is enforced in the
  // handler, this is only the hard ceiling the setting can never exceed (20 MB).
  app.useBodyParser('raw', { type: [CATALOG_IMPORT_MIME], limit: 21 * 1024 * 1024 });
  // Query parameters (personal data) never reach the log, whatever the endpoint.
  app.useGlobalFilters(new SafeExceptionFilter(app.getHttpAdapter()));
  await app.init();
  return app;
}
