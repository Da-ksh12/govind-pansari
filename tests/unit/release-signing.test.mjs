// Release signing for the locally built APK: GP_UPLOAD_STORE_FILE must be found whether it is given as a full path or as the project-relative path
// EAS writes in credentials.json, and a wrong path must say WHICH path it looked at. The plugin keeps android/app/build.gradle that way on a fresh
// `expo prebuild`; the committed build.gradle must say the same thing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const file = (p) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const source = (p) => readFileSync(file(p), 'utf8');

// the plugin imports 'expo/config-plugins'; the transform does not need it, so a stand-in is enough
const require = createRequire(import.meta.url);
const Module = require('node:module');
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  return request === 'expo/config-plugins' ? { withAppBuildGradle: (cfg) => cfg } : realLoad.call(this, request, ...rest);
};
const { applyReleaseSigning } = require(file('plugins/withReleaseSigning.js'));
Module._load = realLoad;

// the shape Expo's template gives android/app/build.gradle before the plugin has touched it
const PRISTINE = `apply plugin: "com.android.application"

android {
    compileSdk 36
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.debug
            minifyEnabled false
        }
    }
}
`;

test('the plugin turns the template into a release build signed with the upload key, never the debug key', () => {
  const out = applyReleaseSigning(PRISTINE);
  assert.match(out, /release \{\s*signingConfig signingConfigs\.release/);
  assert.doesNotMatch(out.slice(out.indexOf('buildTypes')), /signingConfigs\.debug/);
  assert.match(out, /storeFile gpResolveKeystore\(gpStore\)/);
  for (const v of ['GP_UPLOAD_STORE_FILE', 'GP_UPLOAD_STORE_PASSWORD', 'GP_UPLOAD_KEY_ALIAS', 'GP_UPLOAD_KEY_PASSWORD']) assert.ok(out.includes(v), v);
});

test('the keystore helper is defined once, before android { }, and reads relative paths from the project folder', () => {
  const out = applyReleaseSigning(PRISTINE);
  assert.equal((out.match(/def gpResolveKeystore\(/g) ?? []).length, 1);
  assert.ok(out.indexOf('def gpResolveKeystore(') < out.indexOf('\nandroid {'), 'defined before the android block uses it');
  assert.match(out, /new File\(rootProject\.projectDir\.parentFile, cleaned\)/, 'android/ -> its parent is the project folder');
  // the "$'" inside the helper must survive the text replacement (a plain replacement string would expand it)
  assert.ok(out.includes(`replaceAll('^["\\']|["\\']$', '')`), 'the quote-stripping pattern is intact');
});

test('a wrong path is reported with the path that was actually looked at, not just "does not exist"', () => {
  const out = applyReleaseSigning(PRISTINE);
  assert.match(out, /Looked for: \$\{storeFileResolved\.absolutePath\} \(value given: \$\{storePath\}\)/);
  assert.match(out, /Missing: \$\{missing\.join\(', '\)\}/, 'the missing-variable message still names only variable NAMES');
  assert.doesNotMatch(out, /\$\{gpValue\('GP_UPLOAD_(STORE|KEY)_PASSWORD'\)\}/, 'no password is ever put into a message');
});

test('the plugin is idempotent and refuses a build file it does not understand', () => {
  const once = applyReleaseSigning(PRISTINE);
  assert.equal(applyReleaseSigning(once), once);
  assert.throws(() => applyReleaseSigning('android { }'), /signingConfigs\.debug/);
  assert.throws(() => applyReleaseSigning(PRISTINE.replace('signingConfig signingConfigs.debug', 'signingConfig null')), /release signingConfig/);
});

test('the committed android/app/build.gradle matches what the plugin would write', () => {
  const committed = source('android/app/build.gradle');
  const generated = applyReleaseSigning(PRISTINE);
  const body = (text) => text.match(/def gpResolveKeystore\(String raw\) \{[\s\S]*?\n\}\n/)?.[0];
  assert.ok(body(committed), 'the helper is in the committed file');
  assert.equal(body(committed), body(generated), 'same helper');
  assert.match(committed, /storeFile gpResolveKeystore\(gpStore\)/);
  assert.match(committed, /Looked for: \$\{storeFileResolved\.absolutePath\} \(value given: \$\{storePath\}\)/);
  assert.doesNotMatch(committed, /file\(storePath\)/, 'the old check that only looked inside android/app is gone');
});

test('the build script hands Gradle an absolute keystore path and never prints a password', () => {
  const ps = source('scripts/build-release-apk.ps1');
  assert.match(ps, /\$env:GP_UPLOAD_STORE_FILE\s*=\s*\(Resolve-Path \$store\)\.Path/);
  assert.doesNotMatch(ps, /Write-(Host|Output)[^\n]*\$ks\.(keystorePassword|keyPassword)/);
  assert.doesNotMatch(ps, /Write-(Host|Output)[^\n]*\$env:GP_UPLOAD_(STORE|KEY)_PASSWORD/);
  assert.match(ps, /Remove-Item Env:GP_UPLOAD_STORE_PASSWORD, Env:GP_UPLOAD_KEY_PASSWORD/, 'the passwords are removed from the window afterwards');
});
