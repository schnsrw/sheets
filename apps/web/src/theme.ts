import { useEffect, useState } from 'react';

/**
 * Light/dark theme. Manual-only by design (per the project decision) —
 * we don't subscribe to `prefers-color-scheme` because the user
 * explicitly wants control. Default is light; the toggle persists to
 * localStorage so reloads keep the user's pick.
 *
 * The actual theming is driven by a `data-theme` attribute on the
 * `<html>` element; CSS selectors `[data-theme="dark"] :root` and the
 * variable cascade do the rest. Mutating the attribute keeps Univer's
 * own DOM (rendered inside our tree) inside the inheritance chain
 * without needing to re-init the editor.
 */

const STORAGE_KEY = 'casual:theme';
const DEFAULT: Theme = 'light';

export type Theme = 'light' | 'dark';

function readStoredTheme(): Theme {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === 'dark' || v === 'light') return v;
  } catch {
    /* private mode etc. — fall through */
  }
  return DEFAULT;
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme());

  useEffect(() => {
    applyTheme(theme);
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* persistence is best-effort */
    }
  }, [theme]);

  const toggle = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  return { theme, toggle };
}
