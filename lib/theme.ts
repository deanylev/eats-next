export const DEFAULT_PRIMARY_COLOR = '#1b0426';
export const DEFAULT_SECONDARY_COLOR = '#e8a61a';

const hexToRgb = (hex: string): { r: number; g: number; b: number } | null => {
  const normalized = hex.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(normalized)) {
    return null;
  }

  const r = Number.parseInt(normalized.slice(1, 3), 16);
  const g = Number.parseInt(normalized.slice(3, 5), 16);
  const b = Number.parseInt(normalized.slice(5, 7), 16);
  return { r, g, b };
};

const channelToLinear = (channel: number): number => {
  const value = channel / 255;
  if (value <= 0.03928) {
    return value / 12.92;
  }

  return ((value + 0.055) / 1.055) ** 2.4;
};

const getRelativeLuminance = (hex: string): number => {
  const rgb = hexToRgb(hex);
  if (!rgb) {
    return 0;
  }

  const r = channelToLinear(rgb.r);
  const g = channelToLinear(rgb.g);
  const b = channelToLinear(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const getContrastRatio = (l1: number, l2: number): number => {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
};

export const getReadableTextColor = (backgroundHex: string): '#000000' | '#ffffff' => {
  const backgroundLuminance = getRelativeLuminance(backgroundHex);
  const contrastWithBlack = getContrastRatio(backgroundLuminance, 0);
  const contrastWithWhite = getContrastRatio(backgroundLuminance, 1);
  return contrastWithBlack >= contrastWithWhite ? '#000000' : '#ffffff';
};

type ThemeVarPrefix = 'theme' | 'tenant';

const buildActionButtonThemeVariables = (
  primaryColor: string,
  secondaryColor: string,
  prefix: ThemeVarPrefix
): Record<string, string> => {
  const isLightPrimary = getReadableTextColor(primaryColor) === '#000000';

  if (isLightPrimary) {
    return {
      [`--${prefix}-action-bg`]: `color-mix(in srgb, ${secondaryColor} 12%, ${primaryColor})`,
      [`--${prefix}-action-bg-hover`]: `color-mix(in srgb, ${secondaryColor} 16%, ${primaryColor})`,
      [`--${prefix}-action-border`]: `color-mix(in srgb, ${secondaryColor} 50%, ${primaryColor})`,
      [`--${prefix}-action-border-hover`]: `color-mix(in srgb, ${secondaryColor} 58%, ${primaryColor})`,
      [`--${prefix}-action-text`]: secondaryColor,
      [`--${prefix}-action-shadow`]:
        'inset 0 1px 0 rgba(255, 255, 255, 0.18), 0 8px 18px rgba(0, 0, 0, 0.06), 0 2px 6px rgba(0, 0, 0, 0.04)',
      [`--${prefix}-action-shadow-hover`]:
        'inset 0 1px 0 rgba(255, 255, 255, 0.2), 0 10px 22px rgba(0, 0, 0, 0.08), 0 2px 7px rgba(0, 0, 0, 0.05)'
    };
  }

  return {
    [`--${prefix}-action-bg`]: `color-mix(in srgb, ${secondaryColor} 18%, rgba(32, 18, 38, 0.72))`,
    [`--${prefix}-action-bg-hover`]: `color-mix(in srgb, ${secondaryColor} 24%, rgba(32, 18, 38, 0.68))`,
    [`--${prefix}-action-border`]: `color-mix(in srgb, ${secondaryColor} 44%, rgba(255, 255, 255, 0.14))`,
    [`--${prefix}-action-border-hover`]: `color-mix(in srgb, ${secondaryColor} 52%, rgba(255, 255, 255, 0.16))`,
    [`--${prefix}-action-text`]: secondaryColor,
    [`--${prefix}-action-shadow`]:
      'inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 8px 18px rgba(0, 0, 0, 0.12), 0 2px 6px rgba(0, 0, 0, 0.08)',
    [`--${prefix}-action-shadow-hover`]:
      'inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 10px 22px rgba(0, 0, 0, 0.14), 0 2px 7px rgba(0, 0, 0, 0.09)'
  };
};

export const buildThemeCssVariables = (
  primaryColor: string,
  secondaryColor: string,
  prefix: ThemeVarPrefix
): Record<string, string> => ({
  [`--${prefix}-primary`]: primaryColor,
  [`--${prefix}-secondary`]: secondaryColor,
  [`--${prefix}-on-primary`]: getReadableTextColor(primaryColor),
  [`--${prefix}-on-secondary`]: getReadableTextColor(secondaryColor),
  ...buildActionButtonThemeVariables(primaryColor, secondaryColor, prefix)
});
