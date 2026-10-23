import { createContext, useContext, useEffect } from 'react';
import { HEX_COLOR } from './color';
import { accentShades, PALOPS_PRIMARY } from './theme';

export type PrimaryShades = { light: string; dark: string };

/** Lets the public website swap the theme's primary colour for the server's own. */
export const SetPrimaryContext = createContext<(primary: PrimaryShades) => void>(() => undefined);

const STORAGE_KEY = 'palops-site-accent';

/** The server colour from the last visit, so the site doesn't flash PalOps blue before it loads. */
export function cachedSiteAccent(): PrimaryShades {
  try {
    const hex = localStorage.getItem(STORAGE_KEY);
    return hex && HEX_COLOR.test(hex) ? accentShades(hex) : PALOPS_PRIMARY;
  } catch {
    return PALOPS_PRIMARY;
  }
}

/** Applies the server's colour (or PalOps's when it has none) once the server info has loaded. */
export function useSiteAccent(hex: string | null | undefined) {
  const setPrimary = useContext(SetPrimaryContext);
  useEffect(() => {
    if (hex === undefined) return;
    const valid = hex && HEX_COLOR.test(hex) ? hex : null;
    setPrimary(valid ? accentShades(valid) : PALOPS_PRIMARY);
    try {
      if (valid) localStorage.setItem(STORAGE_KEY, valid);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Private windows can refuse storage; the colour still applies.
    }
  }, [hex, setPrimary]);
}
