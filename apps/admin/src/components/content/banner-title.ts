import type { PromoBanner } from '@lummi/contracts';

/** A banner's title in the panel's language, or the «Без заголовка» stand-in while it is empty. */
export const bannerTitle = (
  banner: Pick<PromoBanner, 'titleRu' | 'titleUz'>,
  language: 'ru' | 'uz',
  untitled: string,
): string => (language === 'uz' ? banner.titleUz : banner.titleRu) || untitled;
