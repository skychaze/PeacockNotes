export const shouldRequestBackupNotificationPermission = (
  platform: string,
  apiLevel: string | number,
  isGranted: boolean,
  hasPrompted: boolean,
) => platform === 'android' && Number(apiLevel) >= 33 && !isGranted && !hasPrompted;
