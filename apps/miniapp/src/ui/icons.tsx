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
