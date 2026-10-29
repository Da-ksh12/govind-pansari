# Builds the signed release APK (or AAB) on this PC, using the signing key already in credentials.json.
#
#   .\scripts\build-release-apk.ps1                 -> signed APK
#   .\scripts\build-release-apk.ps1 -Bundle         -> signed AAB (for Google Play)
#   .\scripts\build-release-apk.ps1 -Offline        -> use only what Gradle already downloaded (flaky internet)
#   .\scripts\build-release-apk.ps1 -Check          -> only check the signing key and the Razorpay version, no build
#
# credentials.json and credentials\ are git-ignored (they hold the key passwords). This script READS them, sets the four GP_UPLOAD_* variables for
# THIS run only, and never prints or stores a password.
param(
  [switch]$Bundle,
  [switch]$Offline,
  [switch]$Check
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$credPath = Join-Path $root 'credentials.json'
if (-not (Test-Path $credPath)) { throw "credentials.json not found in $root. It holds the signing key details (downloaded from EAS)." }

$cred = Get-Content $credPath -Raw | ConvertFrom-Json
$ks = $cred.android.keystore
if (-not $ks) { throw 'credentials.json has no android.keystore section.' }
foreach ($field in 'keystorePath', 'keystorePassword', 'keyAlias', 'keyPassword') {
  if (-not $ks.$field) { throw "credentials.json: android.keystore.$field is missing or empty." }
}

# The path in credentials.json is relative to the project folder; Gradle runs from the android folder, so hand it an absolute path.
$store = if ([System.IO.Path]::IsPathRooted($ks.keystorePath)) { $ks.keystorePath } else { Join-Path $root $ks.keystorePath }
if (-not (Test-Path $store)) { throw "The keystore file does not exist: $store" }

$env:GP_UPLOAD_STORE_FILE     = (Resolve-Path $store).Path
$env:GP_UPLOAD_STORE_PASSWORD = $ks.keystorePassword
$env:GP_UPLOAD_KEY_ALIAS      = $ks.keyAlias
$env:GP_UPLOAD_KEY_PASSWORD   = $ks.keyPassword
$env:SENTRY_DISABLE_AUTO_UPLOAD = 'true'

Write-Host "Signing key found: $($env:GP_UPLOAD_STORE_FILE)"
Write-Host 'Signing details loaded (not shown).'

$gradle = Join-Path $root 'android\gradlew.bat'
Push-Location (Join-Path $root 'android')
try {
  $offlineArg = @()
  if ($Offline) { $offlineArg = @('--offline') }

  Write-Host ''
  Write-Host 'Checking which Razorpay payment library version will be used (should say 1.7.20)...'
  & $gradle ':app:dependencyInsight' '--configuration' 'releaseRuntimeClasspath' '--dependency' 'standard-core' @offlineArg
  if ($LASTEXITCODE -ne 0) { throw "The Razorpay check failed (exit code $LASTEXITCODE). Try again with -Offline, or send the first error lines." }

  if ($Check) { Write-Host ''; Write-Host 'Check finished. No build was made.'; return }

  $task = if ($Bundle) { 'bundleRelease' } else { 'assembleRelease' }
  Write-Host ''
  Write-Host "Running $task. The first build can take 10-20 minutes..."
  & $gradle $task @offlineArg
  if ($LASTEXITCODE -ne 0) { throw "Gradle failed (exit code $LASTEXITCODE). Send me the first lines that say 'What went wrong'." }
}
finally {
  Pop-Location
  # Do not leave the passwords in this PowerShell window's environment.
  Remove-Item Env:GP_UPLOAD_STORE_PASSWORD, Env:GP_UPLOAD_KEY_PASSWORD -ErrorAction SilentlyContinue
}

$out = if ($Bundle) { Join-Path $root 'android\app\build\outputs\bundle\release\app-release.aab' } else { Join-Path $root 'android\app\build\outputs\apk\release\app-release.apk' }
if (Test-Path $out) {
  $mb = [math]::Round((Get-Item $out).Length / 1MB, 1)
  Write-Host ''
  Write-Host "DONE. $out  ($mb MB)"
} else {
  Write-Host ''
  Write-Host "Gradle reported success but $out was not found. Look under android\app\build\outputs."
}
