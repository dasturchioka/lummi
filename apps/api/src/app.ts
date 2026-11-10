import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { MAX_PHOTO_BYTES, RECEIPT_UPLOAD_CEILING_BYTES } from '@lummi/contracts';
import { AppModule, type AppDeps } from './app.module';
import { SafeExceptionFilter } from './logging/safe-exception.filter';

export type { AppDeps };

export async function createApp(deps: AppDeps): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(deps), {
    logger: deps.env.NODE_ENV === 'test' ? false : ['error', 'warn', 'log'],
  });
  // Photo uploads are raw image bytes (admin catalog); the cap is enforced again in the handler.
  app.useBodyParser('raw', {
    type: ['image/jpeg', 'image/png', 'image/webp'],
    limit: MAX_PHOTO_BYTES + 1024,
  });
  // Receipt uploads (#28) are raw bytes of any type, told apart by their first bytes in the
  // handler; the handler's cap is the setting `receipts.maxUploadMb`, this is the ceiling above it.
  app.useBodyParser('raw', {
    type: 'application/octet-stream',
    limit: RECEIPT_UPLOAD_CEILING_BYTES,
  });
  // Query parameters (personal data) never reach the log, whatever the endpoint.
  app.useGlobalFilters(new SafeExceptionFilter(app.getHttpAdapter()));
  await app.init();
  return app;
}
