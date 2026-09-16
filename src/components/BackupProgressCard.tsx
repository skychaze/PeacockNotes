import { ActivityIndicator, View } from 'react-native';
import { AppText } from './AppText';
import { Card } from './Card';
import { ProgressFill } from './ProgressFill';
import { useLanguage } from '../i18n/LanguageContext';
import type { Language } from '../i18n/translations';
import { ui } from '../theme/ui';
import { useAppColors } from '../theme/useAppColors';
import type { BackupProgressSnapshot } from '../services/backupProgress';

type BackupProgressCardProps = {
  progress: BackupProgressSnapshot;
};

const formatBytes = (bytes: number, language: Language) => {
  const units = ['B', 'KB', 'MB', 'GB'] as const;
  const unit = Math.min(Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(1024)), units.length - 1);
  return `${new Intl.NumberFormat(language === 'bn' ? 'bn-BD' : 'en-US', { maximumFractionDigits: 1 }).format(bytes / 1024 ** unit)} ${units[unit]}`;
};

export const BackupProgressCard = ({ progress }: BackupProgressCardProps) => {
  const { colors } = useAppColors();
  const { language, t } = useLanguage();
  const progressTotal = progress.bytesTotal ?? progress.itemsTotal ?? null;
  const progressDone = progress.bytesTotal !== null ? progress.bytesDone : progress.itemsDone;
  const progressPercent = progressTotal !== null && progressTotal > 0
    ? Math.min(100, Math.floor(progressDone * 100 / progressTotal))
    : null;

  return (
    <Card style={{ gap: ui.space.sm }}>
      <AppText variant="headline">{t(`backup.progress.kind.${progress.operationKind}`)}</AppText>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: ui.space.sm }}>
        <AppText variant="bodySmall">{t(`backup.progress.step.${progress.step}`)}</AppText>
        {progressPercent === null
          ? <ActivityIndicator color={colors.primary} size="small" />
          : <AppText variant="bodySmall" color={colors.primary}>{progressPercent}%</AppText>}
      </View>
      {progressPercent !== null ? <ProgressFill progress={progressPercent / 100} trackColor={colors.border} fillColor={colors.primary} /> : null}
      <AppText variant="caption" color={colors.textSecondary}>
        {progress.bytesTotal !== null
          ? `${formatBytes(progress.bytesDone, language)} / ${formatBytes(progress.bytesTotal, language)}`
          : progress.bytesDone > 0
            ? formatBytes(progress.bytesDone, language)
            : t('backup.progress.items', { done: progress.itemsDone, total: progress.itemsTotal ?? '?' })}
      </AppText>
      <AppText variant="caption" color={colors.textSecondary}>{t('backup.progress.background')}</AppText>
    </Card>
  );
};
