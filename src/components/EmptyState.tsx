import { MaterialCommunityIcons } from '@expo/vector-icons';
import { View } from 'react-native';
import { AppText } from './AppText';
import { EmptyArt, type EmptyArtName } from './EmptyArt';
import { useAppColors } from '../theme/useAppColors';
import { ui } from '../theme/ui';

type EmptyStateProps = {
  iconName: keyof typeof MaterialCommunityIcons.glyphMap;
  title: string;
  subtitle: string;
};

const ART_BY_ICON: Partial<Record<keyof typeof MaterialCommunityIcons.glyphMap, EmptyArtName>> = {
  'folder-outline': 'folders',
  'folder-clock-outline': 'folders',
  'file-document-outline': 'notes',
  'file-document-plus-outline': 'notes',
  'magnify': 'search',
  'share-variant-outline': 'generic',
};

export const EmptyState = ({ iconName, title, subtitle }: EmptyStateProps) => {
  const { colors } = useAppColors();
  const artName = ART_BY_ICON[iconName] ?? 'generic';

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: ui.space.xl,
      }}
    >
      <View
        style={{
          width: 96,
          height: 96,
          borderRadius: 48,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.surfaceVariant,
          marginBottom: ui.space.md,
        }}
      >
        <EmptyArt name={artName} size={56} />
      </View>
      <AppText variant="title" style={{ textAlign: 'center' }}>
        {title}
      </AppText>
      <AppText
        variant="bodySmall"
        color={colors.textSecondary}
        style={{ marginTop: ui.space.xs, textAlign: 'center' }}
      >
        {subtitle}
      </AppText>
    </View>
  );
};
