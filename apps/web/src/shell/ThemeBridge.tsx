import { useEffect } from 'react';
import { ThemeService } from '@univerjs/core';
import { useUniverAPI } from '../use-univer';
import { useTheme } from '../theme';

/**
 * Mirrors our React-side theme state into Univer's own ThemeService so
 * the canvas chrome (column/row headers, gridlines, selection handles,
 * sidebar, popovers Univer owns) flips with the title-bar toggle.
 *
 * Univer 0.22 exposes `ThemeService.setDarkMode(boolean)` and a
 * `darkMode$` observable; flipping the flag is enough — Univer's render
 * pipeline re-paints with its dark palette. Without this bridge the
 * chrome around the grid is dark while the grid itself stays bright
 * white, which is the exact "we have themes but no themes" mismatch
 * the user flagged.
 *
 * `applyViewOnlyMode`-style pattern: read the injector off FUniver,
 * resolve the service, call the method. Re-runs when api or theme
 * changes.
 */
export function ThemeBridge() {
  const api = useUniverAPI();
  const { theme } = useTheme();

  useEffect(() => {
    if (!api) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const injector = (api as any)._injector as
        | { get: (t: unknown) => unknown }
        | undefined;
      if (!injector) return;
      const themeService = injector.get(ThemeService) as
        | { setDarkMode: (b: boolean) => void; darkMode: boolean }
        | undefined;
      if (!themeService) return;
      const want = theme === 'dark';
      if (themeService.darkMode !== want) themeService.setDarkMode(want);
    } catch (err) {
      console.debug('[theme-bridge] could not reach Univer ThemeService', err);
    }
  }, [api, theme]);

  return null;
}
