import { registerRootComponent } from 'expo';
import { AppRegistry } from 'react-native';

import App from './App';
import { initDb } from './src/database/schema';
import { attemptAutomaticBackup } from './src/services/automaticBackup';
import { finishBackupNotification } from './src/services/backupFolder';
import { resumePendingBackupOperation } from './src/services/backupBackground';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

AppRegistry.registerHeadlessTask('PeacockNotesAutomaticBackup', () => async () => {
  try {
    await initDb();
    await attemptAutomaticBackup();
  } catch (error) {
    // Headless tasks must settle even when startup/database recovery fails;
    // WorkManager can schedule the next policy attempt instead of receiving
    // an unhandled rejection from the JS task.
    console.warn('Automatic backup headless task failed:', error);
  }
});

AppRegistry.registerHeadlessTask('PeacockNotesManualBackup', () => async () => {
  let success = false;
  try {
    await initDb();
    const operation = await resumePendingBackupOperation();
    success = operation === null || operation.state === 'succeeded';
  } catch (error) {
    console.warn('Manual backup recovery failed:', error);
  } finally {
    finishBackupNotification(success);
  }
});
