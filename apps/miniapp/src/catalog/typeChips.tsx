import type { ReactNode } from 'react';
import { BoxIcon, GridIcon, MarsIcon, UnisexIcon, VenusIcon } from '../ui/icons';
import type { FragranceType } from './filters';

const ICONS: Record<FragranceType | 'all' | 'sets', ReactNode> = {
  all: <GridIcon size={16} />,
  homme: <MarsIcon size={16} />,
  femme: <VenusIcon size={16} />,
  unisex: <UnisexIcon size={16} />,
  sets: <BoxIcon size={16} />,
};

/** The type chips of Home and the catalog: the label and a linear icon in the round slot. */
export function typeChipOptions<V extends FragranceType | 'all' | 'sets'>(
  values: readonly V[],
  labels: Record<V, string>,
) {
  return values.map((value) => ({ value, label: labels[value], icon: ICONS[value] }));
}
