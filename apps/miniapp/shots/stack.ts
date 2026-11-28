/**
 * The disposable stack behind the screenshot run and the E2E test (ticket #34): Compose Postgres
 * (and Redis), migrations, the seed catalog and BTS points, the API and the Vite dev server.
 * Anything already listening is reused and left alone; only what this module started is stopped.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import { resolve } from 'node:path';
import { connectShotDb } from './db';

export const repoRoot = resolve(import.meta.dirname, '../../..');

export interface StackOptions {
  /** One compose project per run, so parallel branches do not share a pgdata volume. */
  composeProject: string;
  apiPort: number;
  appPort: number;
  dbPort: number;
  /** Compose publishes Redis too; give it a free host port when 6379 may be taken. */
  redisPort?: number;
  /** Drop the Postgres volume on stop (a disposable stack leaves nothing behind). */
  removeVolumes?: boolean;
}

export interface Stack {
  apiUrl: string;
  appUrl: string;
  databaseUrl: string;
  stop(): void;
}

const listening = (port: number) =>
  new Promise<boolean>((ok) => {
    const s = net.connect(port, '127.0.0.1');
    s.once('connect', () => (s.destroy(), ok(true)));
    s.once('error', () => ok(false));
  });

async function waitFor(port: number, what: string, ms = 60_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await listening(port)) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`${what} did not come up on port ${port}`);
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  const r = spawnSync(cmd, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed`);
}

/** The fragrance cards need the seed catalog and its photos; load it once (idempotent, slow the first time). */
async function ensureCatalog(databaseUrl: string) {
  const db = connectShotDb(databaseUrl);
  try {
    const { rows } = await db.query('select count(photo_hash)::int as n from volumes');
    if (Number(rows[0]?.n ?? 0) >= 201) return;
  } finally {
    await db.end();
  }
  console.log('seeding the 67-fragrance catalog with photos (first run only)');
  run('npm', ['run', 'seed:catalog', '-w', '@lummi/api'], { DATABASE_URL: databaseUrl });
}

export async function startStack(opts: StackOptions): Promise<Stack> {
  const { composeProject, apiPort, appPort, dbPort } = opts;
  const databaseUrl =
    process.env.DATABASE_URL ?? `postgres://lummi:lummi@127.0.0.1:${dbPort}/lummi`;
  const composeEnv: NodeJS.ProcessEnv = {
    POSTGRES_HOST_PORT: String(dbPort),
    ...(opts.redisPort ? { REDIS_HOST_PORT: String(opts.redisPort) } : {}),
  };
  const started: ChildProcess[] = [];
  let startedDb = false;
  let stopping = false;

  const spawnService = (name: string, cmd: string, args: string[], env: NodeJS.ProcessEnv) => {
    const p = spawn(cmd, args, {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      stdio: 'ignore',
      detached: true,
    });
    p.on('exit', (code) => code && !stopping && console.error(`${name} exited with ${code}`));
    started.push(p);
  };

  const stop = () => {
    stopping = true;
    // each service leads its own process group, so npm's node children stop with it
    for (const p of started) if (p.pid) process.kill(-p.pid, 'SIGTERM');
    if (startedDb) {
      spawnSync(
        'docker',
        [
          'compose',
          '-f',
          'docker-compose.dev.yml',
          '-p',
          composeProject,
          'down',
          ...(opts.removeVolumes ? ['-v'] : []),
        ],
        { cwd: repoRoot, stdio: 'ignore', env: { ...process.env, ...composeEnv } },
      );
    }
  };

  try {
    if (!(await listening(apiPort))) {
      if (!(await listening(dbPort))) {
        console.log(
          `starting dev Postgres on ${dbPort} (docker compose project ${composeProject})`,
        );
        run(
          'docker',
          ['compose', '-f', 'docker-compose.dev.yml', '-p', composeProject, 'up', '-d', '--wait'],
          composeEnv,
        );
        startedDb = true;
      }
      run('npm', ['run', 'db:migrate'], { DATABASE_URL: databaseUrl });
      await ensureCatalog(databaseUrl);
      console.log(`starting API on ${apiPort}`);
      spawnService('api', 'npm', ['run', 'start', '-w', '@lummi/api'], {
        API_PORT: String(apiPort),
        DATABASE_URL: databaseUrl,
        SESSION_SECRET: process.env.SESSION_SECRET ?? 'shots-session-secret-shots-session-secret',
      });
      await waitFor(apiPort, 'API');
    }
    // The BTS points come from the committed snapshot (idempotent); delivery screens need them.
    run('npm', ['run', 'bts:import', '-w', '@lummi/api'], { DATABASE_URL: databaseUrl });
    if (!(await listening(appPort))) {
      console.log(`starting Mini App on ${appPort}`);
      spawnService('miniapp', 'npm', ['run', 'dev', '-w', '@lummi/miniapp'], {
        MINIAPP_PORT: String(appPort),
        API_PORT: String(apiPort),
      });
      await waitFor(appPort, 'Mini App');
    }
  } catch (e) {
    stop();
    throw e;
  }
  return {
    apiUrl: `http://127.0.0.1:${apiPort}`,
    appUrl: `http://127.0.0.1:${appPort}`,
    databaseUrl,
    stop,
  };
}

/** The `#tgWebAppData=…` launch params a Telegram client puts in the URL; the app mocks Telegram from them. */
export function launchHash(initData: string, startParam?: string): string {
  return new URLSearchParams({
    tgWebAppData: initData,
    tgWebAppVersion: '8.0',
    tgWebAppPlatform: 'android',
    tgWebAppThemeParams: '{}',
    ...(startParam ? { tgWebAppStartParam: startParam } : {}),
  }).toString();
}
