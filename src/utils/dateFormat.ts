import type { Language } from '../i18n/translations';

type Translate = (key: string) => string;

const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

export const formatMetaDate = (iso: string, language: Language, t: Translate) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const dayDiff = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86_400_000);
  if (dayDiff === 0) {
    return t('date.today');
  }
  if (dayDiff === 1) {
    return t('date.yesterday');
  }

  try {
    return new Intl.DateTimeFormat(language === 'bn' ? 'bn-BD' : 'en-US', {
      day: 'numeric',
      month: 'short',
    }).format(date);
  } catch {
    return `${date.getDate()}/${date.getMonth() + 1}`;
  }
};
