import type { BtsPointDto, DeliveryCityDto, RegionDto } from '@lummi/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '../lib/api';

const TEN_MINUTES = 10 * 60_000;

export function useRegions() {
  return useQuery({
    queryKey: ['delivery', 'regions'],
    queryFn: async () => unwrap(await api.delivery.regions(), 200),
    staleTime: TEN_MINUTES,
  });
}

export function useCities(regionId: number | undefined) {
  return useQuery({
    queryKey: ['delivery', 'cities', regionId],
    enabled: regionId !== undefined,
    queryFn: async () =>
      unwrap(await api.delivery.cities({ params: { regionId: regionId as number } }), 200),
    staleTime: TEN_MINUTES,
  });
}

export function usePoints(args: { regionId?: number; city?: string; q?: string }, enabled = true) {
  return useQuery({
    queryKey: ['delivery', 'points', args.regionId, args.city, args.q],
    enabled,
    queryFn: async () => unwrap(await api.delivery.points({ query: args }), 200),
    staleTime: TEN_MINUTES,
  });
}

const CITY_KEY = ['me', 'delivery-city'] as const;

/** The customer's saved delivery city (null until chosen), with the region's tariff. */
export function useDeliveryCity() {
  return useQuery({
    queryKey: CITY_KEY,
    queryFn: async () => unwrap(await api.me.getDeliveryCity(), 200).deliveryCity,
  });
}

export function useSaveDeliveryCity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { regionId: number; city: string }): Promise<DeliveryCityDto | null> =>
      unwrap(await api.me.setDeliveryCity({ body: v }), 200).deliveryCity,
    onSuccess: (city) => qc.setQueryData(CITY_KEY, city),
  });
}

export type Picked =
  | { kind: 'city'; region: RegionDto; city: string }
  | { kind: 'point'; region: RegionDto; point: BtsPointDto }
  | { kind: 'typed'; region: RegionDto; text: string };

export const regionName = (r: RegionDto, language: 'ru' | 'uz') =>
  language === 'uz' ? r.nameUz : r.nameRu;

/**
 * Where a parcel goes, named in the shopper's language: BTS publishes city names in Russian only
 * (spec Changes 2026-11-09), so RU shows the city and UZ the region's own UZ name rather than a
 * Cyrillic word inside a Latin line («BTS yetkazish, Samarqand viloyati»).
 */
export const deliveryPlace = (region: RegionDto, city: string, language: 'ru' | 'uz') =>
  language === 'uz' ? region.nameUz : city;
