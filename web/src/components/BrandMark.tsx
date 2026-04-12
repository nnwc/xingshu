import React from 'react';

type BrandMarkProps = {
  collapsed?: boolean;
  size?: 'sm' | 'md' | 'lg';
  subtitle?: string;
  center?: boolean;
};

const sizeMap = {
  sm: {
    orb: 28,
    title: 18,
    subtitle: 12,
  },
  md: {
    orb: 36,
    title: 22,
    subtitle: 13,
  },
  lg: {
    orb: 54,
    title: 32,
    subtitle: 14,
  },
};

const BrandMark: React.FC<BrandMarkProps> = ({
  collapsed = false,
  size = 'md',
  subtitle,
  center = false,
}) => {
  const current = sizeMap[size];

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: center ? 'center' : 'flex-start',
        gap: collapsed ? 0 : 12,
        width: '100%',
        textAlign: center ? 'center' : 'left',
      }}
    >
      <div
        style={{
          width: current.orb,
          height: current.orb,
          borderRadius: '50%',
          position: 'relative',
          background: 'radial-gradient(circle at 35% 35%, #fff4bf 0%, #ffd86b 28%, #7c5cff 68%, #16213f 100%)',
          boxShadow: '0 0 18px rgba(124, 92, 255, 0.35), inset 0 0 10px rgba(255,255,255,0.18)',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: -4,
            borderRadius: '50%',
            border: '1.5px solid rgba(125, 211, 252, 0.55)',
            transform: 'rotate(-18deg) scaleX(1.15) scaleY(0.72)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            inset: -8,
            borderRadius: '50%',
            border: '1px solid rgba(167, 139, 250, 0.35)',
            transform: 'rotate(26deg) scaleX(1.22) scaleY(0.58)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: Math.max(8, current.orb * 0.22),
            height: Math.max(8, current.orb * 0.22),
            transform: 'translate(-50%, -50%)',
            borderRadius: '50%',
            background: '#ffe08a',
            boxShadow: '0 0 10px rgba(255, 224, 138, 0.9)',
          }}
        />
      </div>

      {!collapsed && (
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div
            style={{
              fontSize: current.title,
              lineHeight: 1.1,
              fontWeight: 700,
              letterSpacing: '0.02em',
              background: 'linear-gradient(135deg, #7dd3fc 0%, #a78bfa 45%, #ffd86b 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            星枢
          </div>
          {subtitle && (
            <div
              style={{
                marginTop: 4,
                fontSize: current.subtitle,
                color: 'var(--color-text-3)',
                lineHeight: 1.3,
              }}
            >
              {subtitle}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default BrandMark;
