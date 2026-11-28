/** Ports of the E2E stack; every one is an env variable so parallel stacks do not collide (docs/dev.md). */
export const E2E = {
  composeProject: process.env.E2E_COMPOSE_PROJECT ?? 'lummi-e2e',
  apiPort: Number(process.env.API_PORT ?? 4000),
  appPort: Number(process.env.MINIAPP_PORT ?? 5173),
  dbPort: Number(process.env.POSTGRES_HOST_PORT ?? 5432),
  redisPort: process.env.REDIS_HOST_PORT ? Number(process.env.REDIS_HOST_PORT) : undefined,
  /** Signs initData and the contact proof; only the API under test ever checks it. */
  botToken: process.env.BOT_TOKEN ?? '',
};
