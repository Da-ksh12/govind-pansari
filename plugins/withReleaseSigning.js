const { withAppBuildGradle } = require('expo/config-plugins');

// The upload keystore named by GP_UPLOAD_STORE_FILE. A RELATIVE path is read from the project folder (the one holding credentials.json, which is how
// EAS writes it, e.g. credentials/android/keystore.jks) — not from android/app, where Gradle's file() would otherwise start and never find it.
// Quotes and spaces left around a pasted value are ignored.
const KEYSTORE_HELPER = `
// The upload keystore named by GP_UPLOAD_STORE_FILE. A RELATIVE path is read from the project folder (the one holding credentials.json, which is how
// EAS writes it, e.g. credentials/android/keystore.jks) — not from android/app, where Gradle's file() would otherwise start and never find it.
// Quotes and spaces left around a pasted value are ignored.
def gpResolveKeystore(String raw) {
    def cleaned = raw.trim().replaceAll('^["\\']|["\\']$', '')
    def candidate = new File(cleaned)
    return candidate.isAbsolute() ? candidate : new File(rootProject.projectDir.parentFile, cleaned)
}
`;

const SIGNING_BLOCK = `
        release {
            // Upload key is supplied at build time, never committed. See docs: GP_UPLOAD_* variables.
            def gpValue = { String name -> System.getenv(name) ?: project.findProperty(name)?.toString() }
            def gpStore = gpValue('GP_UPLOAD_STORE_FILE')
            if (gpStore) {
                storeFile gpResolveKeystore(gpStore)
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
        def storeFileResolved = gpResolveKeystore(storePath)
        if (!storeFileResolved.exists()) {
            throw new GradleException("GP_UPLOAD_STORE_FILE does not point to an existing keystore file. Looked for: \${storeFileResolved.absolutePath} (value given: \${storePath})")
        }
    }
}
`;

/** The transform itself, on the text of android/app/build.gradle. Exported so a test can run it without a prebuild. */
function applyReleaseSigning(contents) {
  if (contents.includes('GP_UPLOAD_STORE_FILE')) return contents;

  const debugSigning = /(signingConfigs\s*\{\s*debug\s*\{[^}]*\})/;
  if (!debugSigning.test(contents)) {
    throw new Error('withReleaseSigning: could not find the signingConfigs.debug block in android/app/build.gradle');
  }
  contents = contents.replace(debugSigning, (match) => `${match}${SIGNING_BLOCK}`);

  const releaseUsesDebug = /(release\s*\{[^}]*?)signingConfig signingConfigs\.debug/;
  if (!releaseUsesDebug.test(contents)) {
    throw new Error('withReleaseSigning: could not find the release signingConfig line in android/app/build.gradle');
  }
  contents = contents.replace(releaseUsesDebug, (match, head) => `${head}signingConfig signingConfigs.release`);

  // the helper goes right before the android { } block (function replacement: the helper text contains "$'", which a plain replacement string would expand)
  const androidBlock = /\nandroid\s*\{/;
  if (!androidBlock.test(contents)) {
    throw new Error('withReleaseSigning: could not find the android { } block in android/app/build.gradle');
  }
  contents = contents.replace(androidBlock, (match) => `${KEYSTORE_HELPER}${match}`);

  return contents + FAIL_FAST;
}

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    cfg.modResults.contents = applyReleaseSigning(cfg.modResults.contents);
    return cfg;
  });
};
module.exports.applyReleaseSigning = applyReleaseSigning;
