import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type ThemeMode = 'light' | 'dark';

type ThemeContextValue = {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  isSystemTheme: boolean;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = 'xingshu-theme';

const getSystemTheme = (): ThemeMode =>
  window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

const applyTheme = (theme: ThemeMode) => {
  document.body.setAttribute('arco-theme', theme);
  document.documentElement.setAttribute('data-theme', theme);
};

const getStoredTheme = (): ThemeMode | null => {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === 'light' || saved === 'dark' ? saved : null;
};

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<ThemeMode>(() => getStoredTheme() ?? getSystemTheme());
  const [isSystemTheme, setIsSystemTheme] = useState(() => !getStoredTheme());

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleChange = () => {
      if (getStoredTheme()) return;
      setIsSystemTheme(true);
      setThemeState(mediaQuery.matches ? 'dark' : 'light');
    };

    handleChange();
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    applyTheme(theme);
    if (!isSystemTheme) {
      localStorage.setItem(STORAGE_KEY, theme);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [theme, isSystemTheme]);

  const value = useMemo(
    () => ({
      theme,
      setTheme: (nextTheme: ThemeMode) => {
        setIsSystemTheme(false);
        localStorage.setItem(STORAGE_KEY, nextTheme);
        setThemeState(nextTheme);
      },
      toggleTheme: () => {
        setIsSystemTheme(false);
        setThemeState((prev) => {
          const next = prev === 'light' ? 'dark' : 'light';
          localStorage.setItem(STORAGE_KEY, next);
          return next;
        });
      },
      isSystemTheme,
    }),
    [theme, isSystemTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useThemeMode = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useThemeMode must be used within ThemeProvider');
  }
  return context;
};
