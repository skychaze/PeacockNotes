import { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';
import { getKeyboardAwareBottom } from '../utils/keyboardLayout';

export const useKeyboardAwareBottom = (baseBottom: number, safeAreaBottom: number) => {
  const keyboard = useAnimatedKeyboard();

  return useAnimatedStyle(
    () => ({
      bottom: getKeyboardAwareBottom(baseBottom, keyboard.height.value, safeAreaBottom),
    }),
    [baseBottom, safeAreaBottom],
  );
};
