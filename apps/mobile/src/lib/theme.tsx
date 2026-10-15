import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';

export interface Palette {
  mode: 'dark' | 'light';
  bg: string;
  card: string;
  card2: string;
  border: string;
  text: string;
  muted: string;
  faint: string;
  green: string;
  greenSoft: string;
  red: string;
  redSoft: string;
  blue: string;
  amber: string;
  purple: string;
  onAccent: string;
}

const dark: Palette = {
  mode: 'dark',
  bg: '#04070c',
  card: '#0a1018',
  card2: '#101924',
  border: '#1a2635',
  text: '#f2f6fa',
  muted: '#93a3b5',
  faint: '#536273',
  green: '#22e06b',
  greenSoft: 'rgba(34,224,107,0.14)',
  red: '#ff3b3b',
  redSoft: 'rgba(255,59,59,0.14)',
  blue: '#2f7bff',
  amber: '#ffc021',
  purple: '#b25cff',
  onAccent: '#03140a',
};

const light: Palette = {
  mode: 'light',
  bg: '#eef2f6',
  card: '#ffffff',
  card2: '#f4f7fa',
  border: '#d8e0e8',
  text: '#08101a',
  muted: '#566576',
  faint: '#93a0ad',
  green: '#109c47',
  greenSoft: 'rgba(16,156,71,0.12)',
  red: '#d92525',
  redSoft: 'rgba(217,37,37,0.1)',
  blue: '#1f63d6',
  amber: '#c98a00',
  purple: '#8b2fe0',
  onAccent: '#ffffff',
};

export type ThemePref = 'system' | 'dark' | 'light';

interface Ctx {
  c: Palette;
  pref: ThemePref;
  setPref: (p: ThemePref) => void;
  cycle: () => void;
}

const ThemeCtx = createContext<Ctx>({ c: dark, pref: 'system', setPref: () => {}, cycle: () => {} });
const KEY = 'kart:theme';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [pref, setPrefState] = useState<ThemePref>('system');

  useEffect(() => {
    AsyncStorage.getItem(KEY).then((v) => {
      if (v === 'dark' || v === 'light' || v === 'system') setPrefState(v);
    });
  }, []);

  const value = useMemo<Ctx>(() => {
    const mode = pref === 'system' ? (system === 'light' ? 'light' : 'dark') : pref;
    const setPref = (p: ThemePref) => {
      setPrefState(p);
      AsyncStorage.setItem(KEY, p).catch(() => undefined);
    };
    return {
      c: mode === 'dark' ? dark : light,
      pref,
      setPref,
      cycle: () => setPref(mode === 'dark' ? 'light' : 'dark'),
    };
  }, [pref, system]);

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useThemeColors() {
  return useContext(ThemeCtx);
}

/** Números tabulares em negrito, como no RaceChrono. */
export const numeric = { fontVariant: ['tabular-nums' as const], fontWeight: '800' as const };
