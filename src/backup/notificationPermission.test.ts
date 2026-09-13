import { shouldRequestBackupNotificationPermission } from './notificationPermission';

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

export function testBackupNotificationPermissionPromptGate() {
  assert(
    shouldRequestBackupNotificationPermission('android', 33, false, false),
    'Android 13 should prompt before the first attempt',
  );
  assert(
    !shouldRequestBackupNotificationPermission('android', 33, false, true),
    'a denied notification permission prompted again',
  );
  assert(
    !shouldRequestBackupNotificationPermission('android', 33, true, false),
    'granted notification permission prompted again',
  );
  assert(
    !shouldRequestBackupNotificationPermission('android', 32, false, false),
    'pre-Android 13 requested notification permission',
  );
}

export function runNotificationPermissionTests() {
  testBackupNotificationPermissionPromptGate();
}

void Promise.resolve(runNotificationPermissionTests()).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
