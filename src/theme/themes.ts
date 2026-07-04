import type { Theme, ThemeId } from './types';

// Material Design (Material You / M3)
const material: Theme = {
  id: 'material',
  name: 'Material',
  label: 'Material Design',
  colors: {
    primary: '#6750A4',
    primaryHover: '#7C67C7',
    primaryActive: '#4F378B',
    bgRoot: '#FEF7FF',
    bgSurface: '#FFFBFE',
    bgControl: '#E7E0EC',
    bgHover: '#ECE6F0',
    textPrimary: '#1C1B1F',
    textSecondary: '#49454F',
    textMuted: '#79747E',
    borderLight: '#CAC4D0',
    borderNormal: '#79747E',
    success: '#2E7D32',
    warning: '#ED6C02',
    error: '#BA1A1A',
    shadowColor: 'rgba(0,0,0,0.12)',
    glowColor: 'rgba(103,80,164,0.35)',
  },
  cssExtras: {
    '--radius-sm': '8px',
    '--radius-md': '16px',
    '--radius-lg': '24px',
    '--transition-speed': '200ms',
    '--font-family': '"Roboto", "Microsoft YaHei", "Segoe UI", sans-serif',
  },
};

export const themes: Record<string, Theme> = { material };
export const themeList: Theme[] = [material];
export function getTheme(id: ThemeId): Theme { return themes[id] ?? material; }