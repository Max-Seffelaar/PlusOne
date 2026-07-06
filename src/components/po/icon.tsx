/** Single-path stroke icon set, ported from the prototype's `PI` dictionary. */
import type { CSSProperties } from 'react';

export const ICONS = {
  back: 'M15 5l-7 7 7 7',
  close: 'M6 6l12 12M18 6L6 18',
  search: 'M11 11m-6 0a6 6 0 1 0 12 0a6 6 0 1 0-12 0M20 20l-3.8-3.8',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  check: 'M5 12l5 5 9-11',
  chev: 'M9 6l6 6-6 6',
  chevD: 'M6 9l6 6 6-6',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
  share: 'M14 4h6v6M20 4l-9 9M18 13v6H5V6h6',
  cal: 'M4 7h16v13H4zM4 11h16M8 4v4M16 4v4',
  users: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20c0-3.3 2.7-5 6-5s6 1.7 6 5M16 5.4a3 3 0 0 1 0 5.6M18 15c2.2.4 3.6 1.9 3.6 4',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 3.6-6 8-6s8 2 8 6',
  ticket: 'M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2 2 2 0 0 0 0 4 2 2 0 0 1-2 2H6a2 2 0 0 1-2-2 2 2 0 0 0 0-4zM14 6v12',
  star: 'M12 3l2.5 5.4 5.9.8-4.3 4.1 1.1 5.9L12 16.5 6.8 19.2l1.1-5.9L3.6 9.2l5.9-.8z',
  crown: 'M4 18h16M4 18l-1.3-8 4.6 3.4L12 6l4.7 7.4L21 10l-1.3 8',
  note: 'M5 4h10l4 4v12H5zM14 4v5h5M8 13h7M8 16h5',
  money: 'M3 6h18v12H3zM12 12m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0',
  bell: 'M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6M9.5 20a2.5 2.5 0 0 0 5 0',
  shield: 'M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z',
  clock: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 7v5l3 2',
  paste: 'M9 4h6v3H9zM7 5H5v16h14V5h-2M9 12h6M9 16h4',
  contact: 'M4 5h16v14H4zM8 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 16c0-1.6 1.3-2.6 3-2.6s3 1 3 2.6',
  upload: 'M12 15V4M8 8l4-4 4 4M5 19h14',
  cog: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l1.6-1-1.5-2.6-1.8.6-1.5-1-.3-1.9h-3l-.3 1.9-1.5 1-1.8-.6L5 9l1.6 1L6.6 12 5 13l1.5 2.6 1.8-.6 1.5 1 .3 1.9h3l.3-1.9 1.5-1 1.8.6L20.6 13z',
  building: 'M5 21V4h9v17M14 9h5v12M8 8h2M8 12h2M8 16h2M18 13h0M18 17h0',
  arrowR: 'M5 12h14M13 6l6 6-6 6',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  door: 'M6 21V4a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v17M4 21h14M13 12h.01',
  flag: 'M5 21V4M5 4c3-2 6 2 9 0s5-1 5-1v9s-2 1-5 1-6-2-9 0',
  check2: 'M4 12l5 5L20 6',
  warn: 'M12 3l9 16H3zM12 9v5M12 17h0',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 4v4h4M12 8v4l3 2',
  spark: 'M12 3l1.7 5L19 9.7 14 11.4 12 16l-1.7-4.6L5 9.7 10.3 8z',
  logo: 'M12 4v16M4 12h16',
  dl: 'M12 4v11M8 11l4 4 4-4M5 19h14',
  logout: 'M9 21H5V3h4M16 17l5-5-5-5M21 12H9',
  link: 'M9 15l6-6M10 6l1-1a4 4 0 0 1 6 6l-1 1M14 18l-1 1a4 4 0 0 1-6-6l1-1',
  refresh: 'M3 12a9 9 0 0 1 15-6.7L21 8M21 4v4h-4M21 12a9 9 0 0 1-15 6.7L3 16M3 20v-4h4',
  card: 'M3 6h18v12H3zM3 10h18',
  mail: 'M4 5h16v14H4zM4 7l8 6 8-6',
  swap: 'M7 4L3 8l4 4M3 8h13M17 20l4-4-4-4M21 16H8',
  pin: 'M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 10m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L20 18v-2l-5-2 1.5-2.5L21 11V5a16 16 0 0 1-16-1z',
  lock: 'M6 10V8a6 6 0 0 1 12 0v2M5 10h14v10H5z',
  filter: 'M3 5h18l-7 8v5l-4 2v-7z',
  arrowUp: 'M12 19V5M6 11l6-6 6 6',
  inbox: 'M4 13h4l1.5 3h5L16 13h4M4 13l2.5-8h11L20 13v6H4z',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h3v3h-3zM20 14h.01M14 20h.01M20 17h.01M17 20h.01M20 20h.01',
} as const;

export type IconName = keyof typeof ICONS;

export interface IconProps {
  name: IconName;
  size?: number;
  /** stroke width */
  sw?: number;
  /** stroke color (defaults to currentColor — set text color via className) */
  stroke?: string;
  fill?: string;
  className?: string;
  style?: CSSProperties;
}

export function Icon({
  name,
  size = 22,
  sw = 1.9,
  stroke = 'currentColor',
  fill = 'none',
  className,
  style,
}: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke={stroke}
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ display: 'block', flexShrink: 0, ...style }}
      aria-hidden="true"
    >
      <path d={ICONS[name]} />
    </svg>
  );
}

/** Per-role glyphs for the RoleChip (VIP=crown, All Access=shield, …). */
export const ROLE_ICON: Record<string, IconName> = {
  VIP: 'crown',
  'All Access': 'shield',
  Artist: 'star',
  Pers: 'note',
  Crew: 'users',
  Gast: 'user',
};
