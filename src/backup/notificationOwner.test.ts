import assert from 'node:assert/strict';
import { backupNotificationOwner } from './notificationOwner';

assert.equal(backupNotificationOwner({ kind: 'automatic_backup', payload: '{"version":1}' }), 'automatic');
assert.equal(backupNotificationOwner({ kind: 'managed_retention', payload: '{"version":1,"notificationOwner":"automatic"}' }), 'automatic');
assert.equal(backupNotificationOwner({ kind: 'managed_retention', payload: '{"version":1,"notificationOwner":"manual"}' }), 'manual');
assert.equal(backupNotificationOwner({ kind: 'managed_retention', payload: '{"version":1}' }), 'manual');
assert.equal(backupNotificationOwner({ kind: 'managed_retention', payload: 'invalid' }), 'manual');
assert.equal(backupNotificationOwner({ kind: 'import', payload: '{"notificationOwner":"automatic"}' }), 'manual');
