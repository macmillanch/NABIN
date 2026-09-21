interface IconProps {
  size?: number;
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

export const GridIcon = ({ size = 20 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </svg>
);

export const InboxIcon = ({ size = 20 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M3 12h4l2 3h6l2-3h4" />
    <path d="M5 5h14l2 7v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5z" />
  </svg>
);

export const MenuBookIcon = ({ size = 20 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5A2.5 2.5 0 0 0 4 22.5z" />
    <path d="M8 7h8M8 11h6" />
  </svg>
);

export const StoreIcon = ({ size = 20 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M3 9l1.6-5h14.8L21 9" />
    <path d="M3 9h18v3a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z" />
    <path d="M5 15v6h14v-6" />
  </svg>
);

export const BoxesIcon = ({ size = 20 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M3 8l4.5-2.5L12 8l-4.5 2.5z" />
    <path d="M12 8l4.5-2.5L21 8l-4.5 2.5z" />
    <path d="M3 8v6l4.5 2.5V10.5z" />
    <path d="M12 8v6l4.5 2.5V10.5z" />
    <path d="M21 8v6l-4.5 2.5" />
  </svg>
);

export const LogoutIcon = ({ size = 16 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="M16 17l5-5-5-5M21 12H9" />
  </svg>
);

export const BarsIcon = ({ size = 24 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);

export const CloseIcon = ({ size = 20 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export const RefreshIcon = ({ size = 16 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M20 11a8 8 0 1 0-2.3 6.2" />
    <path d="M20 5v6h-6" />
  </svg>
);

export const ClockIcon = ({ size = 16 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3.5 2" />
  </svg>
);

export const PinIcon = ({ size = 16 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11z" />
    <circle cx="12" cy="10" r="2.5" />
  </svg>
);
