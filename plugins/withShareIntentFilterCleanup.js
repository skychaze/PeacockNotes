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

    return config;
  });
};
