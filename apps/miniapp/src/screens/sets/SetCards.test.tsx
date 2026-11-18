import { sharedMessages } from '@lummi/i18n';
import { miniappMessages } from '@lummi/i18n/miniapp';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/prefs', () => ({
  usePrefs: () => ({
    language: 'ru',
    theme: 'light',
    t: { ...sharedMessages.ru, ...miniappMessages.ru },
  }),
}));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../sets/queries', () => ({ useDiscoverySet: () => ({ data: undefined }) }));
vi.mock('../../sets/actions', () => ({
  useSetsText: () => ({ setsLabel: 'Наборы', builderTitle: 'Свой набор', builderCardText: '' }),
}));
vi.mock('../../favourites/queries', () => ({
  useFavouriteIds: () => ({ data: undefined }),
  useToggleFavourite: () => ({ mutate: vi.fn() }),
}));

import { SetCards } from './SetCards';

afterEach(cleanup);

describe('SetCards', () => {
  it('puts the builder card before the Discovery set (#61)', () => {
    render(<SetCards />);
    const builder = screen.getByTestId('builder-card');
    const discovery = screen.getByTestId('discovery-card');
    expect(
      builder.compareDocumentPosition(discovery) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
