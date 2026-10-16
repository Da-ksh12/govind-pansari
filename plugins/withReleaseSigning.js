const { withAppBuildGradle } = require('expo/config-plugins');

const SIGNING_BLOCK = `
        release {
            // Upload key is supplied at build time, never committed. See docs: GP_UPLOAD_* variables.
            def gpValue = { String name -> System.getenv(name) ?: project.findProperty(name)?.toString() }
            def gpStore = gpValue('GP_UPLOAD_STORE_FILE')
            if (gpStore) {
                storeFile file(gpStore)
                storePassword gpValue('GP_UPLOAD_STORE_PASSWORD')
                keyAlias gpValue('GP_UPLOAD_KEY_ALIAS')
                keyPassword gpValue('GP_UPLOAD_KEY_PASSWORD')
            }
        }`;

const FAIL_FAST = `

// Release tasks must never fall back to the debug key: stop early, naming only the missing variables.
gradle.taskGraph.whenReady { graph ->
    def releaseRequested = graph.allTasks.any {
        it.project == project && it.name.toLowerCase().contains('release') &&
            (it.name.startsWith('bundle') || it.name.startsWith('assemble') || it.name.startsWith('sign') || it.name.startsWith('package'))
    }
    if (releaseRequested) {
        def required = ['GP_UPLOAD_STORE_FILE', 'GP_UPLOAD_STORE_PASSWORD', 'GP_UPLOAD_KEY_ALIAS', 'GP_UPLOAD_KEY_PASSWORD']
        def missing = required.findAll { !(System.getenv(it) ?: project.findProperty(it)) }
        if (!missing.isEmpty()) {
            throw new GradleException("Release signing is not configured. Missing: \${missing.join(', ')}")
        }
        def storePath = System.getenv('GP_UPLOAD_STORE_FILE') ?: project.findProperty('GP_UPLOAD_STORE_FILE').toString()
        if (!file(storePath).exists()) {
            throw new GradleException("GP_UPLOAD_STORE_FILE does not point to an existing keystore file.")
        }
    }
}
`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let contents = cfg.modResults.contents;
    if (contents.includes('GP_UPLOAD_STORE_FILE')) return cfg;

    const debugSigning = /(signingConfigs\s*\{\s*debug\s*\{[^}]*\})/;
    if (!debugSigning.test(contents)) {
      throw new Error('withReleaseSigning: could not find the signingConfigs.debug block in android/app/build.gradle');
    }
    contents = contents.replace(debugSigning, `$1${SIGNING_BLOCK}`);

    const releaseUsesDebug = /(release\s*\{[^}]*?)signingConfig signingConfigs\.debug/;
    if (!releaseUsesDebug.test(contents)) {
      throw new Error('withReleaseSigning: could not find the release signingConfig line in android/app/build.gradle');
    }
    contents = contents.replace(releaseUsesDebug, '$1signingConfig signingConfigs.release');

    cfg.modResults.contents = contents + FAIL_FAST;
    return cfg;
  });
};
