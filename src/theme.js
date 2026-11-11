import { useEffect, useState } from 'react';

const KEY = 'microservicehub-theme';

/** Light unless the person switched to dark themselves. */
export function getTheme() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    // Storage unavailable: stay on light.
  }
  return 'light';
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0c1713' : '#0b7a5b');
}

/** [theme, toggle] for a light/dark switch. */
export function useTheme() {
  const [theme, setTheme] = useState(getTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // The choice just will not survive a refresh.
    }
    setTheme(next);
  }

  return [theme, toggle];
}
