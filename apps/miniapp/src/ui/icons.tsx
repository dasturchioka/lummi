/*
 * Every icon. The first screen's own (tab bar, Home, the shared states and buttons) live in
 * `icons-core`, which the first screen imports directly; the rest load with the screens that draw
 * them (ADR 0030 budget). Import from here anywhere but the first screen.
 */
import { Icon, type P } from './icons-core';

export * from './icons-core';

export const PhoneIcon = (p: P) => (
  <Icon d="M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2" {...p} />
);
export const CheckIcon = (p: P) => <Icon d="m5.5 12.5 4 4 9-9" {...p} />;
/** Circular arrow: update / refresh (the "update Telegram" state). */
export const RefreshIcon = (p: P) => (
  <Icon d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4v3.5H16" {...p} />
);
/** Speech bubble: «Написать менеджеру». */
export const ChatIcon = (p: P) => (
  <Icon
    d="M5 5h14a1 1 0 0 1 1 1v9.5a1 1 0 0 1-1 1h-7.5L7 20v-3.5H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"
    {...p}
  />
);
/** A page of text: an info page that is not there (its not-found state). */
export const DocIcon = (p: P) => (
  <Icon
    d="M7 3.5h7.5L19 8v12a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 7 20zM14.5 3.5V8H19M9.5 12.5h6M9.5 16h6"
    {...p}
  />
);
export const CloseIcon = (p: P) => <Icon d="M6 6l12 12M18 6 6 18" {...p} />;
/** A LUMMI bottle: cap, neck, body, label line. The empty Home and anything "fragrance". */
export const BottleIcon = (p: P) => (
  <Icon
    d="M10 3.5h4v3h-4zM11 6.5v2M13 6.5v2M8.5 8.5h7a2.5 2.5 0 0 1 2.5 2.5v7.5a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 6 18.5V11a2.5 2.5 0 0 1 2.5-2.5zM9.5 14.5h5"
    {...p}
  />
);
export const ArrowLeftIcon = (p: P) => <Icon d="m15 5-7 7 7 7" {...p} />;
/** Leaves the app (the Uzum shop): an arrow out of a corner. */
export const ExternalIcon = (p: P) => (
  <Icon
    d="M13.5 4.5h6v6M19.5 4.5l-8 8M17 14v4.5a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1H10"
    {...p}
  />
);
export const ShareIcon = (p: P) => (
  <Icon d="M12 15.5V4M8 7.5 12 4l4 3.5M6 11v7.5a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V11" {...p} />
);
/** The four characteristics (approved icon row): longevity, sillage, season, time of day. */
export const ClockIcon = (p: P) => (
  <Icon d="M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM12 7.5V12l3 2" {...p} />
);
export const WaveIcon = (p: P) => (
  <Icon
    d="M3.5 9c2.2-2.4 4.3-2.4 6.5 0s4.3 2.4 6.5 0c1.5-1.6 2.9-2.1 4-1.8M3.5 15c2.2-2.4 4.3-2.4 6.5 0s4.3 2.4 6.5 0c1.5-1.6 2.9-2.1 4-1.8"
    {...p}
  />
);
export const LeafIcon = (p: P) => (
  <Icon
    d="M5 19c-.5-8.5 4.5-14 14-14.5.5 9-4.5 14.5-14 14.5zM5 19c2.5-4.5 5.5-7.500 9.5-9.5"
    {...p}
  />
);
export const SunIcon = (p: P) => (
  <Icon
    d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6 18 18M18 6l-1.4 1.4M7.4 16.6 6 18"
    {...p}
  />
);
export const MoonIcon = (p: P) => <Icon d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z" {...p} />;
/** Day and evening in one glyph: a sun over a crescent. */
export const SunMoonIcon = (p: P) => (
  <Icon
    d="M8.5 12.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.5 3v1.200M3 9.5h1.200M4.7 5.700l.9.9M12.3 5.700l-.9.9M20 15.5a5 5 0 0 1-6.5-6.5 5.5 5.5 0 1 0 6.5 6.5z"
    {...p}
  />
);
export const GlobeIcon = (p: P) => (
  <Icon
    d="M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM3.5 12h17M12 3.5c2.2 2.3 3.3 5.1 3.3 8.5s-1.1 6.2-3.3 8.5c-2.2-2.3-3.3-5.1-3.3-8.5s1.1-6.2 3.3-8.5z"
    {...p}
  />
);
/** Half-filled disc: the theme (light / dark) setting. */
export const ContrastIcon = (p: P) => (
  <Icon
    d="M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM12 3.5v17M12 7.5h4.5M12 11.5h5.5M12 15.5h4.5"
    {...p}
  />
);

export const PinIcon = (p: P) => (
  <Icon
    d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11zM12 12.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z"
    {...p}
  />
);
export const PlusIcon = (p: P) => <Icon d="M12 5.5v13M5.5 12h13" {...p} />;
/** A price tag: the promo code field. */
export const TagIcon = (p: P) => (
  <Icon
    d="M3.5 11.6V4.5a1 1 0 0 1 1-1h7.1a1 1 0 0 1 .7.3l8.2 8.2a1 1 0 0 1 0 1.4l-7.1 7.1a1 1 0 0 1-1.4 0l-8.2-8.2a1 1 0 0 1-.3-.7zM8 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"
    {...p}
  />
);
export const MinusIcon = (p: P) => <Icon d="M5.5 12h13" {...p} />;
export const TrashIcon = (p: P) => (
  <Icon d="M4.5 7h15M9.5 7V5h5v2M6.5 7l.8 12h9.4l.8-12M10 10.5v5.5M14 10.5v5.5" {...p} />
);
/** A wrapped box with a bow: «Это подарок». */
export const GiftIcon = (p: P) => (
  <Icon
    d="M4.5 9h15v3h-15zM5.5 12h13v7.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1zM12 9v11.5M12 9c-1-2.8-4.5-4-5.3-2.2C5.9 8.6 9.5 9 12 9zM12 9c1-2.8 4.5-4 5.3-2.2C18.1 8.6 14.5 9 12 9z"
    {...p}
  />
);
/** A delivery van: BTS delivery to the point. */
export const TruckIcon = (p: P) => (
  <Icon
    d="M3.5 6.5h10v10h-10zM13.5 9.5h3.6l3.4 3.5v3.5h-7zM7.5 18.8a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6zM17 18.8a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6z"
    {...p}
  />
);
/** A calendar page: the date of birth field (mockup 06). */
export const CalendarIcon = (p: P) => (
  <Icon
    d="M5.5 6h13a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM4.5 10h15M8.5 4v4M15.5 4v4"
    {...p}
  />
);
