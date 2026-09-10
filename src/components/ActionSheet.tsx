import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRef } from 'react';
import { BottomSheet } from './BottomSheet';
import { PressableScale } from './PressableScale';
import { AppText } from './AppText';
import { useAppColors } from '../theme/useAppColors';
import { useQuality } from '../theme/quality';
import { ui } from '../theme/ui';

export type ActionSheetRow = {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  destructive?: boolean;
  onPress: () => void;
};

type ActionSheetProps = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  rows: ActionSheetRow[];
};

export const ActionSheet = ({ visible, onClose, title, rows }: ActionSheetProps) => {
  const { colors } = useAppColors();
  const { motionEnabled } = useQuality();
  const pendingAction = useRef<(() => void) | null>(null);

  const runRow = (action: () => void) => {
    pendingAction.current = action;
    onClose();
    setTimeout(
      () => {
        const next = pendingAction.current;
        pendingAction.current = null;
        next?.();
      },
      motionEnabled ? 220 : 0
    );
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title={title}>
      {rows.map((row) => (
        <PressableScale
          key={row.label}
          onPress={() => runRow(row.onPress)}
          android_ripple={{ color: colors.surfaceVariant }}
          style={{
            height: 52,
            flexDirection: 'row',
            alignItems: 'center',
            gap: ui.space.md,
            paddingHorizontal: ui.space.lg,
          }}
        >
          <MaterialCommunityIcons
            name={row.icon}
            size={22}
            color={row.destructive ? colors.error : colors.textSecondary}
          />
          <AppText variant="headline" color={row.destructive ? colors.error : colors.text}>
            {row.label}
          </AppText>
        </PressableScale>
      ))}
    </BottomSheet>
  );
};
