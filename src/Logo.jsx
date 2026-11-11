import { useId } from 'react';

/** MicroServiceHub mark: a hub with four connected nodes (one gold accent). */
export function LogoMark({ size = 36 }) {
  const gradientId = useId();

  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="MicroServiceHub" className="logo-mark">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2a8a63" />
          <stop offset="1" stopColor="#123d2d" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill={`url(#${gradientId})`} />
      <g stroke="#ffffff" strokeWidth="3" strokeLinecap="round" opacity="0.92">
        <line x1="32" y1="32" x2="16" y2="18" />
        <line x1="32" y1="32" x2="48" y2="18" />
        <line x1="32" y1="32" x2="16" y2="46" />
        <line x1="32" y1="32" x2="48" y2="46" />
      </g>
      <circle cx="32" cy="32" r="8.5" fill="#ffffff" />
      <circle cx="32" cy="32" r="3.5" fill="#1f6f50" />
      <circle cx="16" cy="18" r="5" fill="#ffffff" />
      <circle cx="16" cy="46" r="5" fill="#ffffff" />
      <circle cx="48" cy="46" r="5" fill="#ffffff" />
      <circle cx="48" cy="18" r="5.5" fill="#f4c542" />
    </svg>
  );
}

/** Mark plus the "MicroServiceHub" wordmark. Set `light` on dark backgrounds. */
export default function Logo({ size = 36, light = false }) {
  return (
    <span className={`logo ${light ? 'logo-light' : ''}`}>
      <LogoMark size={size} />
      <span className="logo-text">
        MicroService<b>Hub</b>
      </span>
    </span>
  );
}
