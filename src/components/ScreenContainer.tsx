import type { PropsWithChildren } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Atmosphere } from './Atmosphere';

export const ScreenContainer = ({ children }: PropsWithChildren) => {
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, paddingBottom: Math.max(insets.bottom, 8) }}>
      <Atmosphere />
      {children}
    </View>
  );
};
