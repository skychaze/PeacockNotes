export const formatBackupDate = (value: string | number, language: 'bn' | 'en'): string | null => {
  const timestamp = typeof value === 'number' ? value : Date.parse(value);
  if (!timestamp || Number.isNaN(timestamp)) return null;
  const date = new Date(timestamp);
  const locale = language === 'bn' ? 'bn-BD' : 'en-US';
  const day = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
  const time = new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(date);
  return `${day} - ${time}`;
};
