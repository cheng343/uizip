// 主题系统核心类型定义
export type ThemeId = 'material';

export interface ThemeColors {
  // 主色调
  primary: string;
  primaryHover: string;
  primaryActive: string;

  // 背景层
  bgRoot: string;
  bgSurface: string;
  bgControl: string;
  bgHover: string;

  // 文字
  textPrimary: string;
  textSecondary: string;
  textMuted: string;

  // 边框
  borderLight: string;
  borderNormal: string;

  // 状态
  success: string;
  warning: string;
  error: string;

  // 特殊效果
  shadowColor: string;
  glowColor: string;
}

export interface Theme {
  id: ThemeId;
  name: string;
  label: string;
  colors: ThemeColors;
  // 额外的 CSS 变量值
  cssExtras: Record<string, string>;
}
