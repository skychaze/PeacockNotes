const normalizeHex = (color: string) => {
  const raw = color.replace('#', '').trim();
  if (raw.length === 3) {
    return raw
      .split('')
      .map((part) => `${part}${part}`)
      .join('');
  }
  return raw;
};

const hexToRgb = (color: string) => {
  const hex = normalizeHex(color);
  if (hex.length !== 6) {
    return null;
  }

  const value = Number.parseInt(hex, 16);
  if (Number.isNaN(value)) {
    return null;
  }

  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
};

const getRelativeLuminance = (color: string) => {
  const rgb = hexToRgb(color);
  if (!rgb) {
    return 0;
  }

  const normalize = (channel: number) => {
    const value = channel / 255;
    return value <= 0.03928
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * normalize(rgb.r) + 0.7152 * normalize(rgb.g) + 0.0722 * normalize(rgb.b);
};

export const getContrastColor = (
  backgroundColor: string,
  darkColor = '#0B1320',
  lightColor = '#FFFFFF'
) => {
  const luminance = getRelativeLuminance(backgroundColor);
  return luminance > 0.45 ? darkColor : lightColor;
};
