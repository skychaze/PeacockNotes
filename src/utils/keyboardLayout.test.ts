import { getKeyboardAwareBottom, getKeyboardOffset } from './keyboardLayout';

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

export function testKeyboardAwareBottom() {
  assert(getKeyboardOffset(0, 24) === 0, 'the keyboard offset is zero when the keyboard is hidden');
  assert(getKeyboardOffset(320, 24) === 296, 'the keyboard offset excludes the safe area');
  assert(getKeyboardAwareBottom(22, 0, 24) === 22, 'the base position stays unchanged without a keyboard');
  assert(getKeyboardAwareBottom(10, 320, 24) === 306, 'the overlay clears the keyboard above the safe area');
  assert(getKeyboardAwareBottom(10, 12, 24) === 10, 'a short keyboard inset never moves an overlay below its base');
}

void Promise.resolve(testKeyboardAwareBottom()).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
