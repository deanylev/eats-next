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

export const buildThemeCssVariables = (
  primaryColor: string,
  secondaryColor: string,
  prefix: ThemeVarPrefix
): Record<string, string> => ({
  [`--${prefix}-primary`]: primaryColor,
  [`--${prefix}-secondary`]: secondaryColor,
  [`--${prefix}-on-primary`]: getReadableTextColor(primaryColor),
  [`--${prefix}-on-secondary`]: getReadableTextColor(secondaryColor)
});
