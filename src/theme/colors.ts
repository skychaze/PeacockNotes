export type ThemeColors = {
  background: string;
  backgroundDeep: string;
  surface: string;
  surfaceVariant: string;
  glass: string;
  glassBorder: string;
  text: string;
  textSecondary: string;
  primary: string;
  primaryBright: string;
  onPrimary: string;
  gradient: [string, string];
  border: string;
  error: string;
  atmosphere: [string, string, string];
  atmosphereOpacity: number;
};

export type FolderAccent = {
  light: string;
  inkLight: string;
  dark: string;
  inkDark: string;
};

export const FOLDER_ACCENTS: FolderAccent[] = [
  { light: '#FFE3D8', inkLight: '#B23A1A', dark: '#3B2620', inkDark: '#FFB49A' },
  { light: '#FFEDC9', inkLight: '#94620A', dark: '#382E1C', inkDark: '#FFD28A' },
  { light: '#EDF4C2', inkLight: '#5F7010', dark: '#2F3418', inkDark: '#D8E37E' },
  { light: '#D2F2DD', inkLight: '#176B3D', dark: '#1E3327', inkDark: '#8EE8AE' },
  { light: '#D5ECFB', inkLight: '#1B6392', dark: '#1F2F3A', inkDark: '#9CD8F5' },
  { light: '#E4DFFF', inkLight: '#5340C9', dark: '#2A2740', inkDark: '#C4B9FF' },
  { light: '#FDDBEB', inkLight: '#A52C68', dark: '#3A2430', inkDark: '#FFA8CE' },
  { light: '#D0F0EC', inkLight: '#0E6E66', dark: '#1D3230', inkDark: '#7FE0D4' },
];

export const AppTheme: { light: ThemeColors; dark: ThemeColors } = {
  light: {
    background: '#F7F6F2',
    backgroundDeep: '#EFF1EC',
    surface: '#FFFFFF',
    surfaceVariant: '#EEEDE7',
    glass: 'rgba(255,255,255,0.02)',
    glassBorder: 'rgba(25,25,23,0.08)',
    text: '#191917',
    textSecondary: '#5F5F59',
    primary: '#0A7D62',
    primaryBright: '#12B58C',
    onPrimary: '#FFFFFF',
    gradient: ['#0FA37B', '#0A7D62'],
    border: '#E4E3DC',
    error: '#B3261E',
    atmosphere: ['#FFD9BC', '#BDEBDC', '#CBDCFB'],
    atmosphereOpacity: 0.5,
  },
  dark: {
    background: '#121214',
    backgroundDeep: '#0C0D10',
    surface: '#1C1C1F',
    surfaceVariant: '#28282C',
    glass: 'rgba(22,22,26,0.02)',
    glassBorder: 'rgba(255,255,255,0.10)',
    text: '#F2F2ED',
    textSecondary: '#A5A59F',
    primary: '#4FD1A5',
    primaryBright: '#7FE8C4',
    onPrimary: '#04231A',
    gradient: ['#5ADBB4', '#35B89C'],
    border: '#303036',
    error: '#F2B8B5',
    atmosphere: ['#0B4A42', '#182D57', '#361C40'],
    atmosphereOpacity: 0.55,
  },
};

export const getThemeColors = (isDark: boolean) =>
  isDark ? AppTheme.dark : AppTheme.light;
