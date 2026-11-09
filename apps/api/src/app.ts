import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule, type AppDeps } from './app.module';
import { SafeExceptionFilter } from './logging/safe-exception.filter';

export type { AppDeps };

export async function createApp(deps: AppDeps): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.register(deps), {
    logger: deps.env.NODE_ENV === 'test' ? false : ['error', 'warn', 'log'],
  });
  // Query parameters (personal data) never reach the log, whatever the endpoint.
  app.useGlobalFilters(new SafeExceptionFilter(app.getHttpAdapter()));
  await app.init();
  return app;
}
