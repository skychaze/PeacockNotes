import type { BackupOperation } from './types';

export type BackupNotificationOwner = 'manual' | 'automatic';

export const backupNotificationOwner = (operation: Pick<BackupOperation, 'kind' | 'payload'>): BackupNotificationOwner => {
  if (operation.kind === 'automatic_backup') return 'automatic';
  if (operation.kind === 'managed_retention') {
    try {
      const payload: unknown = JSON.parse(operation.payload);
      if (typeof payload === 'object' && payload !== null && 'notificationOwner' in payload && payload.notificationOwner === 'automatic') {
        return 'automatic';
      }
    } catch {
      return 'manual';
    }
  }
  return 'manual';
};
