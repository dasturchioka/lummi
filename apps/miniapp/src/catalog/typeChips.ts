import { photoUrl } from '../lib/media';
import type { FragranceType } from './filters';

type Photos = Partial<Record<FragranceType | 'all', string | null>>;

/** The photo-circle type chips of Home and the catalog: the label, and the top seller's bottle. */
export function typeChipOptions<V extends FragranceType | 'all' | 'sets'>(
  values: readonly V[],
  labels: Record<V, string>,
  photos: Photos | undefined,
) {
  return values.map((value) => {
    const hash = value === 'sets' ? null : photos?.[value as FragranceType | 'all'];
    return { value, label: labels[value], thumb: hash ? photoUrl(hash, 400) : undefined };
  });
}
