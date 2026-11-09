import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule, type AppDeps } from './app.module';

export type { AppDeps };

export async function createApp(deps: AppDeps): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.register(deps), {
    logger: deps.env.NODE_ENV === 'test' ? false : ['error', 'warn', 'log'],
  });
  await app.init();
  return app;
}
