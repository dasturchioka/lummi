import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { campaignCodeOf } from '@lummi/contracts/constants';
import { App } from './app/App';
import { router } from './app/router';
import { session } from './lib/api';
import { applyInitialTheme } from './lib/prefs';
import { routeForStartParam } from './lib/startapp';
import { bootTelegram, launchStartParam, telegramReady } from './lib/telegram';
import './styles/index.css';

applyInitialTheme();

async function main() {
  await bootTelegram();

  // `startapp` -> route, once, on launch. Unknown values land on Home.
  const start = launchStartParam();
  const campaign = campaignCodeOf(start);
  if (campaign && location.pathname === '/') {
    // `l_<code>`: the API logs the open and names the target (ticket #35); loaded only for these launches
    void import('./lib/campaign').then((m) => m.openCampaignLaunch(campaign));
  } else if (start !== null && location.pathname === '/') {
    void router.navigate({ to: routeForStartParam(start), replace: true });
  }

  // Sign in once; every request after this carries the session. The shell does not wait for it.
  void session.start().catch(() => undefined);

  createRoot(document.getElementById('root') as HTMLElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  telegramReady();
}

void main();
