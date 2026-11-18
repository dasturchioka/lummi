import type { PromoBanner } from '@lummi/contracts';
import { sharedMessages, type Language } from '@lummi/i18n';
import { miniappMessages } from '@lummi/i18n/miniapp';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useSearch,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { parseCatalogSearch } from '../../catalog/filters';

let language: Language = 'ru';
vi.mock('../../lib/prefs', () => ({
  usePrefs: () => ({
    language,
    theme: 'light',
    t: { ...sharedMessages[language], ...miniappMessages[language] },
  }),
}));
let banners: PromoBanner[] = [];
vi.mock('../../content/home', () => ({
  useHomeContent: () => ({ data: { banners, slogan: null } }),
}));
vi.mock('../../sets/queries', () => ({ useDiscoverySet: () => ({ data: undefined }) }));

import { BannerSlider } from './BannerSlider';

// the router restores the window's scroll on navigation; jsdom has none
beforeAll(() => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});
afterEach(() => {
  cleanup();
  language = 'ru';
  banners = [];
});

const promo = (id: number, titleRu: string): PromoBanner => ({
  id,
  imageHash: null,
  titleRu,
  titleUz: `${titleRu} uz`,
  subtitleRu: 'Тёплые ароматы на вечер',
  subtitleUz: 'Kechqurun uchun iliq iforlar',
  priceLineRu: null,
  priceLineUz: null,
  target: 'catalog',
});

/** Home with the slider, and a catalog route that shows the search it was opened with. */
function renderHome() {
  const root = createRootRoute({ component: Outlet });
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/', component: BannerSlider }),
      createRoute({
        getParentRoute: () => root,
        path: '/catalog',
        validateSearch: parseCatalogSearch,
        component: function CatalogStub() {
          const search = useSearch({ strict: false });
          return <p data-testid="catalog">{JSON.stringify(search)}</p>;
        },
      }),
    ]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

describe('Home banner slider (#62)', () => {
  it('shows the Discovery set slide first, then the active banners in the order given, with one mark each', async () => {
    banners = [promo(7, 'Осенняя подборка'), promo(3, 'Подарок к празднику')];
    renderHome();
    const carousel = await screen.findByRole('region', { name: 'Предложения' });
    expect(carousel.getAttribute('aria-roledescription')).toBe('карусель');
    expect(screen.getByTestId('banner-track').getAttribute('aria-live')).toBe('polite');
    const slides = within(carousel).getAllByRole('group');
    expect(slides.map((s) => s.getAttribute('aria-label'))).toEqual(['1 из 3', '2 из 3', '3 из 3']);
    expect(slides.every((s) => s.getAttribute('aria-roledescription') === 'слайд')).toBe(true);
    expect(slides[0]!.querySelector('[data-slot="discovery"]')).not.toBeNull();
    // the promo slides are their own chunk
    expect(await within(slides[1]!).findByText('Осенняя подборка')).toBeTruthy();
    expect(await within(slides[2]!).findByText('Подарок к празднику')).toBeTruthy();
    const marks = within(screen.getByTestId('banner-dots')).getAllByRole('button');
    expect(marks.map((m) => m.getAttribute('aria-label'))).toEqual([
      'Показать слайд 1 из 3',
      'Показать слайд 2 из 3',
      'Показать слайд 3 из 3',
    ]);
    expect(marks.map((m) => m.getAttribute('aria-current'))).toEqual(['true', null, null]);
  });

  it('with no banner on it is the Discovery slide alone, with no position marks', async () => {
    renderHome();
    const carousel = await screen.findByRole('region', { name: 'Предложения' });
    expect(within(carousel).getAllByRole('group')).toHaveLength(1);
    expect(screen.queryByTestId('banner-dots')).toBeNull();
  });

  it('tapping the Discovery slide opens the catalog on «Наборы», not the set page', async () => {
    banners = [promo(7, 'Осенняя подборка')];
    const router = renderHome();
    const link = await screen.findByRole('link', { name: 'Набор: Discovery set' });
    expect(link.getAttribute('href')).toBe('/catalog?type=sets');
    fireEvent.click(link);
    expect((await screen.findByTestId('catalog')).textContent).toBe('{"type":"sets"}');
    expect(router.state.location.pathname).toBe('/catalog');
  });

  it('speaks Uzbek in Uzbek', async () => {
    language = 'uz';
    banners = [promo(7, 'Kuz')];
    renderHome();
    const carousel = await screen.findByRole('region', { name: 'Takliflar' });
    expect(carousel.getAttribute('aria-roledescription')).toBe('karusel');
    expect(within(carousel).getAllByRole('group')[1]!.getAttribute('aria-label')).toBe('2 tadan 2');
    expect(screen.getByRole('link', { name: 'Toʻplam: Discovery set' })).toBeTruthy();
    expect(
      within(screen.getByTestId('banner-dots'))
        .getAllByRole('button')[1]!
        .getAttribute('aria-label'),
    ).toBe('2-slaydni koʻrsatish, jami 2');
  });
});
