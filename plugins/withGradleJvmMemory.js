const { withGradleProperties } = require('expo/config-plugins');

const JVM_ARGS = '-Xmx2048m -XX:MaxMetaspaceSize=1024m';

module.exports = function withGradleJvmMemory(config) {
  return withGradleProperties(config, (config) => {
    const property = config.modResults.find(
      (entry) => entry.type === 'property' && entry.key === 'org.gradle.jvmargs'
    );

    if (property) {
      property.value = JVM_ARGS;
    } else {
      config.modResults.push({
        type: 'property',
        key: 'org.gradle.jvmargs',
        value: JVM_ARGS,
      });
    }

    return config;
  });
};
