import { registerRootComponent } from 'expo';
import { AppRegistry } from 'react-native';

import App from './App';
import { initDb } from './src/database/schema';
import { attemptAutomaticBackup } from './src/services/automaticBackup';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

AppRegistry.registerHeadlessTask('PeacockNotesAutomaticBackup', () => async () => {
  await initDb();
  await attemptAutomaticBackup();
});
