export const getKeyboardOffset = (keyboardHeight: number, safeAreaBottom: number) => {
  'worklet';
  return Math.max(0, keyboardHeight - safeAreaBottom);
};

export const getKeyboardAwareBottom = (
  baseBottom: number,
  keyboardHeight: number,
  safeAreaBottom: number,
) => {
  'worklet';
  return baseBottom + getKeyboardOffset(keyboardHeight, safeAreaBottom);
};
