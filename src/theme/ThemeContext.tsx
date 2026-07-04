import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { themes } from './themes'; import type { Theme, ThemeId } from './types';

interface ThemeCtx {
  theme: Theme;
  setThemeId: (id: ThemeId) => void;
}

const ThemeContext = createContext<ThemeCtx | null>(null);

const STORAGE_KEY = 'uizip-theme';

function readStoredTheme(): ThemeId {
  try {
    const raw: string | null = localStorage.getItem(STORAGE_KEY);
    if (raw && raw in themes) return raw as ThemeId;
  } catch { /* noop */ }
  return 'material';
}

function applyCSSVariables(theme: Theme) {
  const root = document.documentElement;
  const { colors, cssExtras } = theme;

  for (const [key, value] of Object.entries(colors)) {
    root.style.setProperty(`--color-${key}`, value);
  }
  for (const [key, value] of Object.entries(cssExtras)) {
    root.style.setProperty(key, value);
  }

  // 鐗规畩澶勭悊鐜荤拑鎬佽儗鏅浘
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => themes[readStoredTheme()]);

  useEffect(() => {
    applyCSSVariables(theme);
  }, [theme]);

  const setThemeId = useCallback((id: ThemeId) => {
    const t = themes[id];
    if (!t) return;
    setTheme(t);
    try { localStorage.setItem(STORAGE_KEY, id); } catch { /* noop */ }
  }, []);

  const value = useMemo<ThemeCtx>(() => ({ theme, setThemeId }), [theme, setThemeId]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
