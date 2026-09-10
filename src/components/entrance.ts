import { useCallback } from 'react';
import { FadeInDown } from 'react-native-reanimated';
import { useQuality } from '../theme/quality';

export const useEntrance = () => {
  const { motionEnabled } = useQuality();

  return useCallback(
    (index: number) =>
      motionEnabled ? FadeInDown.duration(300).delay(Math.min(index, 8) * 40) : undefined,
    [motionEnabled]
  );
};
