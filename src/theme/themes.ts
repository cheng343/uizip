import type { Theme, ThemeId } from './types';

// Material Design (Material You / M3)
const material: Theme = {
  id: 'material',
  name: 'Material',
  label: 'Material Design',
  isDark: false,
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
    '--app-bg': 'var(--color-bgRoot)',
  },
};

// Dark — 深邃夜间主题，蓝紫点缀
const dark: Theme = {
  id: 'dark',
  name: 'Dark',
  label: '深色模式',
  isDark: true,
  colors: {
    primary: '#8AB4F8',
    primaryHover: '#A8C7FA',
    primaryActive: '#6A9BE8',
    bgRoot: '#12121E',
    bgSurface: '#1A1A2E',
    bgControl: '#22223A',
    bgHover: '#2A2A4A',
    textPrimary: '#E8E8F0',
    textSecondary: '#B4B4C8',
    textMuted: '#7A7A94',
    borderLight: '#2A2A4A',
    borderNormal: '#3A3A5A',
    success: '#6EE7A8',
    warning: '#F5C518',
    error: '#FF6B6B',
    shadowColor: 'rgba(0,0,0,0.5)',
    glowColor: 'rgba(138,180,248,0.35)',
  },
  cssExtras: {
    '--radius-sm': '8px',
    '--radius-md': '14px',
    '--radius-lg': '20px',
    '--transition-speed': '200ms',
    '--font-family': '"Microsoft YaHei", "Segoe UI", sans-serif',
    '--app-bg': 'var(--color-bgRoot)',
  },
};

// Glassmorphism — 玻璃拟态，渐变背景 + 半透明毛玻璃
const glassmorphism: Theme = {
  id: 'glassmorphism',
  name: 'Glass',
  label: '玻璃拟态',
  isDark: true,
  colors: {
    primary: '#818CF8',
    primaryHover: '#A5B0FB',
    primaryActive: '#6366F1',
    bgRoot: 'rgba(255,255,255,0.06)',
    bgSurface: 'rgba(255,255,255,0.08)',
    bgControl: 'rgba(255,255,255,0.10)',
    bgHover: 'rgba(255,255,255,0.16)',
    textPrimary: '#F5F5FF',
    textSecondary: '#D0D0E8',
    textMuted: '#9A9ABE',
    borderLight: 'rgba(255,255,255,0.12)',
    borderNormal: 'rgba(255,255,255,0.22)',
    success: '#5EEAD4',
    warning: '#FDE047',
    error: '#FB7185',
    shadowColor: 'rgba(0,0,0,0.35)',
    glowColor: 'rgba(129,140,248,0.45)',
  },
  cssExtras: {
    '--radius-sm': '10px',
    '--radius-md': '18px',
    '--radius-lg': '26px',
    '--transition-speed': '250ms',
    '--font-family': '"Microsoft YaHei", "Segoe UI", sans-serif',
    '--app-bg': 'linear-gradient(135deg,#0f0c29 0%,#302b63 50%,#24243e 100%)',
    '--glass-blur': '18px',
  },
};

// Neumorphism — 新拟态，柔和内外阴影
const neumorphism: Theme = {
  id: 'neumorphism',
  name: 'Neumorphism',
  label: '新拟态',
  isDark: false,
  colors: {
    primary: '#6C63FF',
    primaryHover: '#8078FF',
    primaryActive: '#5348E0',
    bgRoot: '#E0E5EC',
    bgSurface: '#E0E5EC',
    bgControl: '#E0E5EC',
    bgHover: '#D6DBE3',
    textPrimary: '#3A4256',
    textSecondary: '#5A6274',
    textMuted: '#8A93A6',
    borderLight: 'transparent',
    borderNormal: 'rgba(163,177,198,0.4)',
    success: '#27AE60',
    warning: '#E67E22',
    error: '#E74C3C',
    shadowColor: 'rgba(163,177,198,0.6)',
    glowColor: 'rgba(108,99,255,0.3)',
  },
  cssExtras: {
    '--radius-sm': '10px',
    '--radius-md': '18px',
    '--radius-lg': '24px',
    '--transition-speed': '200ms',
    '--font-family': '"Microsoft YaHei", "Segoe UI", sans-serif',
    '--app-bg': 'var(--color-bgRoot)',
    '--neu-light': 'rgba(255,255,255,0.9)',
    '--neu-dark': 'rgba(163,177,198,0.6)',
  },
};

export const themes: Record<string, Theme> = { material, dark, glassmorphism, neumorphism };
export const themeList: Theme[] = [material, dark, glassmorphism, neumorphism];
export function getTheme(id: ThemeId): Theme { return themes[id] ?? material; }
