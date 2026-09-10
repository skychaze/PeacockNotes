import type { PropsWithChildren } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassSurface } from './GlassSurface';
import { IconButton } from './IconButton';
import { useLanguage } from '../i18n/LanguageContext';
import { ui } from '../theme/ui';

export const TOP_BAR_HEIGHT = 56;

type TopBarProps = PropsWithChildren<{
  onBack?: () => void;
}>;

export const TopBar = ({ onBack, children }: TopBarProps) => {
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        top: insets.top + ui.space.sm,
        left: ui.space.lg,
        right: ui.space.lg,
        zIndex: 10,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      {onBack ? (
        <GlassSurface
          radius={ui.radius.pill}
          contentStyle={{
            width: TOP_BAR_HEIGHT,
            height: TOP_BAR_HEIGHT,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <IconButton
            icon="arrow-left"
            onPress={onBack}
            accessibilityLabel={t('common.back')}
          />
        </GlassSurface>
      ) : (
        <View />
      )}

      <GlassSurface
        radius={ui.radius.pill}
        contentStyle={{
          height: TOP_BAR_HEIGHT,
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: ui.space.sm,
          gap: ui.space.sm,
        }}
      >
        {children}
      </GlassSurface>
    </View>
  );
};
