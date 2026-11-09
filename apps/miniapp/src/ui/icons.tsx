import type { SVGProps } from 'react';

/** Linear icons: 24 px grid, 1.5 px stroke, round caps and joins, currentColor (DESIGN.md). */
function Icon({ d, size = 24, ...rest }: { d: string; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      <path d={d} />
    </svg>
  );
}

type P = { size?: number } & SVGProps<SVGSVGElement>;
export const HomeIcon = (p: P) => (
  <Icon d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" {...p} />
);
export const GridIcon = (p: P) => (
  <Icon d="M4.5 4.5h6v6h-6zM13.5 4.5h6v6h-6zM4.5 13.5h6v6h-6zM13.5 13.5h6v6h-6z" {...p} />
);
export const BagIcon = (p: P) => <Icon d="M5.5 8h13l-1 11.5h-11zM9 8V7a3 3 0 0 1 6 0v1" {...p} />;
export const BoxIcon = (p: P) => (
  <Icon d="M12 3.5 20 7.8v8.4L12 20.5 4 16.2V7.8zM4 7.8l8 4.4 8-4.4M12 12.2v8.3" {...p} />
);
export const UserIcon = (p: P) => (
  <Icon
    d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20c.6-3.6 3.6-5.5 7.5-5.5s6.9 1.9 7.5 5.5"
    {...p}
  />
);
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
export const AlertIcon = (p: P) => (
  <Icon d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5v5.5M12 16.3v.1" {...p} />
);
export const ChevronIcon = (p: P) => <Icon d="m9 6 6 6-6 6" {...p} />;
export const CloseIcon = (p: P) => <Icon d="M6 6l12 12M18 6 6 18" {...p} />;
export const SearchIcon = (p: P) => (
  <Icon d="M10.5 17.5a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM15.5 15.5 20 20" {...p} />
);
/** A LUMMI bottle: cap, neck, body, label line. The empty Home and anything "fragrance". */
export const BottleIcon = (p: P) => (
  <Icon
    d="M10 3.5h4v3h-4zM11 6.5v2M13 6.5v2M8.5 8.5h7a2.5 2.5 0 0 1 2.5 2.5v7.5a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 6 18.5V11a2.5 2.5 0 0 1 2.5-2.5zM9.5 14.5h5"
    {...p}
  />
);
export const ArrowLeftIcon = (p: P) => <Icon d="m15 5-7 7 7 7" {...p} />;
/** «Все →» at the end of a section's title line. */
export const ArrowRightIcon = (p: P) => <Icon d="M5 12h14M13.5 6.5 19 12l-5.5 5.5" {...p} />;
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

/** Busy indicator for a button or row: a 1.5 px arc that turns, in currentColor. */
export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      data-spin=""
      className="animate-[spin_0.8s_linear_infinite]"
    >
      <circle
        cx="12"
        cy="12"
        r="8.5"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="1.5"
      />
      <path
        d="M20.5 12A8.5 8.5 0 0 0 12 3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
export const PinIcon = (p: P) => (
  <Icon
    d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11zM12 12.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z"
    {...p}
  />
);
export const PlusIcon = (p: P) => <Icon d="M12 5.5v13M5.5 12h13" {...p} />;
export const MinusIcon = (p: P) => <Icon d="M5.5 12h13" {...p} />;
export const TrashIcon = (p: P) => (
  <Icon d="M4.5 7h15M9.5 7V5h5v2M6.5 7l.8 12h9.4l.8-12M10 10.5v5.5M14 10.5v5.5" {...p} />
);
