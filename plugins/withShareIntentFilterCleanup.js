const { withAndroidManifest } = require('expo/config-plugins');

const SHARE_ACTIONS = new Set([
  'android.intent.action.SEND',
  'android.intent.action.SEND_MULTIPLE',
]);

const isShareIntentFilter = (intentFilter) => {
  const actions = Array.isArray(intentFilter.action) ? intentFilter.action : [intentFilter.action];
  return actions.some((action) => SHARE_ACTIONS.has(action?.['$']?.['android:name']));
};

// expo-share-intent appends its filters on every prebuild; strip them first so reruns stay idempotent.
module.exports = function withShareIntentFilterCleanup(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    manifest.$ ??= {};
    manifest.$['xmlns:tools'] ??= 'http://schemas.android.com/tools';
    manifest['uses-permission'] ??= [];
    for (const name of [
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_DATA_SYNC',
    ]) {
      if (!manifest['uses-permission'].some((entry) => entry?.['$']?.['android:name'] === name)) {
        manifest['uses-permission'].push({ $: { 'android:name': name } });
      }
    }

    const application = config.modResults.manifest.application?.find(
      (entry) => entry['$']?.['android:name'] === '.MainApplication'
    );
    const mainActivity = application?.activity?.find(
      (entry) => entry['$']?.['android:name'] === '.MainActivity'
    );

    if (mainActivity?.['intent-filter']) {
      mainActivity['intent-filter'] = mainActivity['intent-filter'].filter(
        (intentFilter) => !isShareIntentFilter(intentFilter)
      );
    }

    if (application) {
      application.service ??= [];
      for (const serviceName of ['.ManualBackupForegroundService', '.ManualBackupTaskService', '.AutomaticBackupTaskService']) {
        if (!application.service.some((entry) => entry?.['$']?.['android:name'] === serviceName)) {
          application.service.push({
            $: {
              'android:name': serviceName,
              'android:exported': 'false',
              'android:foregroundServiceType': 'dataSync',
            },
          });
        }
      }
      const systemForegroundService = application.service.find(
        (entry) => entry?.['$']?.['android:name'] === 'androidx.work.impl.foreground.SystemForegroundService'
      );
      if (systemForegroundService) {
        systemForegroundService.$['android:foregroundServiceType'] = 'dataSync';
        systemForegroundService.$['tools:node'] = 'merge';
      } else {
        application.service.push({
          $: {
            'android:name': 'androidx.work.impl.foreground.SystemForegroundService',
            'android:exported': 'false',
            'android:foregroundServiceType': 'dataSync',
            'tools:node': 'merge',
          },
        });
      }
    }

    return config;
  });
};
