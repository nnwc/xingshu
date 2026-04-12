import React from 'react';

type IconProps = {
  size?: number;
  active?: boolean;
};

const baseStyle = (active: boolean) => ({
  color: active ? '#8b5cf6' : 'currentColor',
  opacity: active ? 1 : 0.92,
});

const wrap = (children: React.ReactNode, active = false, size = 18) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={baseStyle(active)}
  >
    {children}
  </svg>
);

export const IconStarDashboard: React.FC<IconProps> = ({ size = 18, active = false }) =>
  wrap(
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
      <path d="M12 7.2l1.35 3.45 3.45 1.35-3.45 1.35L12 16.8l-1.35-3.45L7.2 12l3.45-1.35L12 7.2z" />
    </>,
    active,
    size
  );

export const IconOrbitTask: React.FC<IconProps> = ({ size = 18, active = false }) =>
  wrap(
    <>
      <circle cx="12" cy="12" r="2.2" />
      <ellipse cx="12" cy="12" rx="7.5" ry="3.4" transform="rotate(-20 12 12)" />
      <path d="M12 5.2v2.1M17.8 12h1.6M12 16.7v2.1M4.6 12H6.2" />
    </>,
    active,
    size
  );

export const IconScriptSheet: React.FC<IconProps> = ({ size = 18, active = false }) =>
  wrap(
    <>
      <path d="M7 3.8h7l4 4v12.4a1.8 1.8 0 0 1-1.8 1.8H7.8A1.8 1.8 0 0 1 6 20.2V5.6A1.8 1.8 0 0 1 7.8 3.8z" />
      <path d="M14 3.8v4h4" />
      <path d="M9 10.2h6M9 13h6M9 15.8h3.8" />
    </>,
    active,
    size
  );

export const IconVariableNodes: React.FC<IconProps> = ({ size = 18, active = false }) =>
  wrap(
    <>
      <circle cx="7" cy="8" r="2.2" />
      <circle cx="17" cy="8" r="2.2" />
      <circle cx="12" cy="16.5" r="2.2" />
      <path d="M8.9 9.2l2 5.1M15.1 9.2l-2 5.1M9.3 8H14.7" />
    </>,
    active,
    size
  );

export const IconDependBox: React.FC<IconProps> = ({ size = 18, active = false }) =>
  wrap(
    <>
      <path d="M12 3.8l7 4v8.4l-7 4-7-4V7.8l7-4z" />
      <path d="M5 8.2l7 4 7-4M12 12.2v8" />
    </>,
    active,
    size
  );

export const IconSubscriptionWave: React.FC<IconProps> = ({ size = 18, active = false }) =>
  wrap(
    <>
      <path d="M6 8.5a8 8 0 0 1 12 0" />
      <path d="M4.5 12a10 10 0 0 1 15 0" />
      <path d="M7.5 15.2a6 6 0 0 1 9 0" />
      <circle cx="12" cy="18" r="1.3" fill="currentColor" stroke="none" />
    </>,
    active,
    size
  );

export const IconLogTrail: React.FC<IconProps> = ({ size = 18, active = false }) =>
  wrap(
    <>
      <path d="M7 4.5h10a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2z" />
      <path d="M8.5 9.2h7M8.5 12h7M8.5 14.8h4.5" />
      <path d="M15.8 17.2l1.1 1.1 2-2.2" />
    </>,
    active,
    size
  );

export const IconConfigOrbit: React.FC<IconProps> = ({ size = 18, active = false }) =>
  wrap(
    <>
      <circle cx="12" cy="12" r="2.6" />
      <path d="M12 4.5v2.1M12 17.4v2.1M19.5 12h-2.1M6.6 12H4.5M17.3 6.7l-1.5 1.5M8.2 15.8l-1.5 1.5M17.3 17.3l-1.5-1.5M8.2 8.2 6.7 6.7" />
      <ellipse cx="12" cy="12" rx="7.6" ry="3.4" transform="rotate(-18 12 12)" opacity="0.5" />
    </>,
    active,
    size
  );

export const IconNotifyBell: React.FC<IconProps> = ({ size = 18, active = false }) =>
  wrap(
    <>
      <path d="M8.2 17.2h7.6" />
      <path d="M9 18.2a3 3 0 0 0 6 0" />
      <path d="M6.8 16.2c1.1-1 1.7-2.5 1.7-4.1v-1.3a3.5 3.5 0 1 1 7 0v1.3c0 1.6.6 3.1 1.7 4.1" />
      <path d="M10.8 5.6a2 2 0 0 1 2.4 0" opacity="0.65" />
    </>,
    active,
    size
  );
