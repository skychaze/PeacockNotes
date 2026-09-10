import { AppText } from './AppText';
import { PressableScale } from './PressableScale';
import { useAppColors } from '../theme/useAppColors';
import { ui } from '../theme/ui';

type ChipProps = {
  label: string;
  selected?: boolean;
  onPress?: () => void;
};

export const Chip = ({ label, selected = false, onPress }: ChipProps) => {
  const { colors } = useAppColors();

  return (
    <PressableScale
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      style={{
        alignSelf: 'flex-start',
        height: 34,
        borderRadius: ui.radius.pill,
        paddingHorizontal: ui.space.lg,
        backgroundColor: selected ? colors.primary : colors.surfaceVariant,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <AppText
        variant="caption"
        color={selected ? colors.onPrimary : colors.text}
        numberOfLines={1}
      >
        {label}
      </AppText>
    </PressableScale>
  );
};
