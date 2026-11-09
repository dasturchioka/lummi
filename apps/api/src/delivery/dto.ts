import type { AdminBtsPointDto, AdminRegionDto, BtsPointDto, RegionDto } from '@lummi/contracts';
import type { BtsPointRow, RegionRow } from '@lummi/db';

export const toRegionDto = (r: RegionRow): RegionDto => ({
  id: r.id,
  nameRu: r.nameRu,
  nameUz: r.nameUz,
  deliveryTariff: r.deliveryTariff,
});

export const toPointDto = (p: BtsPointRow): BtsPointDto => ({
  id: p.id,
  code: p.code,
  regionId: p.regionId,
  city: p.city,
  name: p.name,
  address: p.address,
  landmark: p.landmark,
  hours: p.hours,
});

export const toAdminRegionDto = (
  r: RegionRow,
  pointCount: number,
  activePointCount: number,
): AdminRegionDto => ({ ...toRegionDto(r), code: r.code, pointCount, activePointCount });

export const toAdminPointDto = (p: BtsPointRow, r: RegionRow): AdminBtsPointDto => ({
  ...toPointDto(p),
  active: p.active,
  regionNameRu: r.nameRu,
  regionNameUz: r.nameUz,
});
