import type { StaffDto } from '@lummi/contracts';
import {
  ChartColumn,
  CreditCard,
  Droplet,
  FileText,
  House,
  Link2,
  MapPin,
  Megaphone,
  MessageSquareText,
  ScrollText,
  ShoppingBag,
  SlidersHorizontal,
  TicketPercent,
  UserCog,
  Users,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';
import type { AdminMessages } from './i18n';

type Role = StaffDto['role'];
type NavKey = Exclude<
  keyof AdminMessages['nav'],
  'label' | 'menu' | 'close' | 'soon' | 'soonTag' | 'signOut' | 'groups'
>;

export type NavItem = {
  key: NavKey;
  icon: LucideIcon;
  /** `null` until the ticket that builds the section sets its route; shown as "coming later". */
  href: string | null;
  roles: readonly Role[];
};
export type NavGroup = { key: keyof AdminMessages['nav']['groups'] | null; items: NavItem[] };

const ALL: readonly Role[] = ['owner', 'manager'];
const OWNER: readonly Role[] = ['owner'];

/**
 * The panel's sections, in menu order. Roles follow ADR 0017: managers handle orders, stock and
 * BTS points; everything else is the owner's. The API guards are the real gate; this only hides
 * what a role can't open. A later ticket fills its section by setting `href`.
 */
export const NAV: NavGroup[] = [
  { key: null, items: [{ key: 'home', icon: House, href: '/', roles: ALL }] },
  {
    key: 'sales',
    items: [
      { key: 'orders', icon: ShoppingBag, href: null, roles: ALL },
      { key: 'btsPoints', icon: MapPin, href: '/bts-points', roles: ALL },
      { key: 'customers', icon: Users, href: null, roles: OWNER },
      { key: 'reviews', icon: MessageSquareText, href: null, roles: OWNER },
    ],
  },
  {
    key: 'shop',
    items: [
      { key: 'catalog', icon: Droplet, href: '/catalog', roles: OWNER },
      { key: 'stock', icon: Warehouse, href: null, roles: ALL },
      { key: 'content', icon: FileText, href: '/content', roles: OWNER },
    ],
  },
  {
    key: 'marketing',
    items: [
      { key: 'promoCodes', icon: TicketPercent, href: null, roles: OWNER },
      { key: 'campaignLinks', icon: Link2, href: null, roles: OWNER },
      { key: 'broadcasts', icon: Megaphone, href: '/broadcasts', roles: OWNER },
    ],
  },
  {
    key: 'manage',
    items: [
      { key: 'reports', icon: ChartColumn, href: null, roles: OWNER },
      { key: 'shopCard', icon: CreditCard, href: '/shop-card', roles: OWNER },
      { key: 'settings', icon: SlidersHorizontal, href: '/settings', roles: OWNER },
      { key: 'audit', icon: ScrollText, href: '/audit', roles: OWNER },
      { key: 'staff', icon: UserCog, href: '/staff', roles: OWNER },
    ],
  },
];

export function navFor(role: Role): NavGroup[] {
  return NAV.map((g) => ({ ...g, items: g.items.filter((i) => i.roles.includes(role)) })).filter(
    (g) => g.items.length > 0,
  );
}

/** The item whose route owns `pathname` (longest prefix wins; `/` only matches itself). */
export function isActive(href: string, pathname: string) {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}
