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

export const TableIcon = ({ size = 20 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M4 6h16M4 6v12M20 6v12M8 6v12M16 6v12M4 11h16" />
  </svg>
);

export const TakeawayIcon = ({ size = 20 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
    <line x1="3" y1="6" x2="21" y2="6" />
    <path d="M16 10a4 4 0 0 1-8 0" />
  </svg>
);

export const DeliveryIcon = ({ size = 20 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="5.5" cy="17.5" r="3.5" />
    <circle cx="18.5" cy="17.5" r="3.5" />
    <path d="M15 6h4l3 5v6.5h-3.5" />
    <path d="M2 17.5V6a2 2 0 0 1 2-2h11v13.5H9" />
  </svg>
);

export const KdsIcon = ({ size = 20 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  </svg>
);

export const StaffIcon = ({ size = 20 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

export const ReportsIcon = ({ size = 20 }: IconProps) => (
  <svg {...base(size)}>
    <line x1="18" y1="20" x2="18" y2="10" />
    <line x1="12" y1="20" x2="12" y2="4" />
    <line x1="6" y1="20" x2="6" y2="14" />
  </svg>
);

export const SettlementIcon = ({ size = 20 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <line x1="2" y1="10" x2="22" y2="10" />
    <path d="M12 14v4M10 16h4" />
  </svg>
);

export const SettingsIcon = ({ size = 20 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

export const CheckIcon = ({ size = 20 }: IconProps) => (
  <svg {...base(size)}>
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export const PlusIcon = ({ size = 20 }: IconProps) => (
  <svg {...base(size)}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

export const QrIcon = ({ size = 20 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
    <rect x="14" y="14" width="3" height="3" />
    <rect x="18" y="18" width="3" height="3" />
  </svg>
);
