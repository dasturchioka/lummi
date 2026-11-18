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
vi.mock('../../sets/actions', async () => {
  const { setsMessages } = await import('@lummi/i18n/sets');
  return { useSetsText: () => setsMessages.ru.sets };
});
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

  it('shows the 5 × 5 ml set after the 5 × 10 ml one, by its own name, without a heart (ADR 0042)', () => {
    render(<SetCards />);
    const ten = screen.getByTestId('discovery-card');
    const five = screen.getByTestId('discovery-5-card');
    expect(ten.compareDocumentPosition(five) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(five.textContent).toContain('Discovery set 5 × 5 мл');
    expect(five.parentElement?.querySelector('[aria-pressed]')).toBeNull();
  });
});
