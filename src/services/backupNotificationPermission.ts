import AsyncStorage from '@react-native-async-storage/async-storage';
import { PermissionsAndroid, Platform } from 'react-native';
import { shouldRequestBackupNotificationPermission } from '../backup/notificationPermission';

const PROMPT_ATTEMPTED_KEY = 'backup.notificationPermissionPromptAttempted';

let promptAttempt: Promise<void> | null = null;

const requestBackupNotificationPermission = async () => {
  try {
    const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
    const [isGranted, hasPrompted] = await Promise.all([
      Platform.OS === 'android' && Number(Platform.Version) >= 33
        ? PermissionsAndroid.check(permission)
        : Promise.resolve(false),
      AsyncStorage.getItem(PROMPT_ATTEMPTED_KEY).then(Boolean),
    ]);
    if (!shouldRequestBackupNotificationPermission(Platform.OS, Platform.Version, isGranted, hasPrompted)) return;
    await AsyncStorage.setItem(PROMPT_ATTEMPTED_KEY, '1');
    await PermissionsAndroid.request(permission);
  } catch (error) {
    console.warn('Could not request backup notification permission:', error);
  }
};

export const requestBackupNotificationPermissionOnce = (): Promise<void> => {
  if (!promptAttempt) promptAttempt = requestBackupNotificationPermission();
  return promptAttempt;
};
