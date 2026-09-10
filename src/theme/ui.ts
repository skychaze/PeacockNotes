import type { TextStyle } from 'react-native';

export type TypeVariant = 'display' | 'title' | 'headline' | 'body' | 'bodySmall' | 'caption';
export type TypeToken = {
  size: number;
  weight: TextStyle['fontWeight'];
  lineHeight: number;
};

export const ui: {
  radius: { sm: number; md: number; lg: number; xl: number; sheet: number; fab: number; pill: number };
  space: { xs: number; sm: number; md: number; lg: number; xl: number; xxl: number; xxxl: number };
  type: Record<TypeVariant, TypeToken>;
} = {
  radius: { sm: 8, md: 12, lg: 16, xl: 24, sheet: 28, fab: 18, pill: 999 },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 },
  type: {
    display: { size: 32, weight: '700', lineHeight: 38 },
    title: { size: 22, weight: '700', lineHeight: 28 },
    headline: { size: 17, weight: '600', lineHeight: 22 },
    body: { size: 16, weight: '400', lineHeight: 24 },
    bodySmall: { size: 14, weight: '400', lineHeight: 20 },
    caption: { size: 12, weight: '500', lineHeight: 16 },
  },
};
