import { QueryClient } from '@tanstack/react-query';
import { watchStaleChoice } from '../cart/stale-choice';
import { queryDefaults } from './queryDefaults';
import { installLiveFocus } from '../lib/live-focus';

export const queryClient = new QueryClient(queryDefaults);

// from launch: the first cart answer (the tab bar's) may be the one reporting a stale choice (#39)
watchStaleChoice(queryClient);
installLiveFocus();
