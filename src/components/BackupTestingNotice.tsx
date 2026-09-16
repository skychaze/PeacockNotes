import { Linking, View } from 'react-native';
import { AppText } from './AppText';
import { PressableScale } from './PressableScale';
import { useLanguage } from '../i18n/LanguageContext';
import { ui } from '../theme/ui';
import { useAppColors } from '../theme/useAppColors';

const SUPPORT_EMAIL = 'priyanshuroy777@gmail.com';
const GMAIL_COMPOSE_URL = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(SUPPORT_EMAIL)}`;

export const BackupTestingNotice = () => {
  const { colors } = useAppColors();
  const { t } = useLanguage();

  const openGmail = async () => {
    try {
      await Linking.openURL(GMAIL_COMPOSE_URL);
    } catch (error) {
      console.warn('Could not open Gmail:', error);
    }
  };

  return (
    <View style={{ gap: ui.space.xs, paddingHorizontal: ui.space.xs }}>
      <AppText variant="bodySmall" color={colors.textSecondary}>
        {t('backup.testingNotice')}
      </AppText>
      <PressableScale
        accessibilityRole="link"
        accessibilityLabel={SUPPORT_EMAIL}
        onPress={() => void openGmail()}
        style={{ alignSelf: 'flex-start', paddingVertical: ui.space.xs }}
      >
        <AppText variant="bodySmall" color={colors.primary} style={{ textDecorationLine: 'underline' }}>
          {SUPPORT_EMAIL}
        </AppText>
      </PressableScale>
    </View>
  );
};
