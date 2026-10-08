// Builds the release APK on this PC and puts it where the website's "Android app" button finds it.
//   cd mobile && npm run build:apk
// Needs: Android SDK (ANDROID_HOME), Java 17, and credentials/ (release signing key).
const { execSync, spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const app = require(path.join(root, 'app.json')).expo
const run = (cmd, cwd) => {
  console.log(`\n> ${cmd}`)
  execSync(cmd, { cwd, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' } })
}

if (!fs.existsSync(path.join(root, 'credentials', 'keystore.properties'))) {
  console.error('credentials/keystore.properties is missing: the APK would be signed with the debug key. Aborting.')
  process.exit(1)
}

// React Native's native (C++) build breaks on Windows with long project paths: the Android SDK's
// ninja can't see files past 260 characters and loops ("build.ninja still dirty after 100 tries").
// So on Windows we mirror this folder to a SHORT path (C:\bdb\mobile, or BOX_BUILD_DIR\mobile)
// and build there. robocopy only copies what changed, so later builds are quick.
let buildRoot = root
if (process.platform === 'win32') {
  buildRoot = path.join(process.env.BOX_BUILD_DIR || 'C:\\bdb', 'mobile')
  if (/\s/.test(buildRoot) || buildRoot.length > 20) {
    console.error(`Build folder ${buildRoot} must be short and without spaces (set BOX_BUILD_DIR, e.g. C:\\bdb).`)
    process.exit(1)
  }
  console.log(`\nMirroring the app to ${buildRoot} (short path for the native build)…`)
  // /MIR mirror. Generated top-level folders are excluded by FULL path (a bare name like "android"
  // would also skip libraries' own android/ folders). Native caches (.cxx) in the mirror are kept.
  const skip = ['android', 'ios', '.expo', 'dist'].map((d) => path.join(root, d))
  const r = spawnSync(
    'robocopy',
    [root, buildRoot, '/MIR', '/XD', ...skip, '.cxx', '/NFL', '/NDL', '/NJH', '/NJS', '/NP'],
    { stdio: 'inherit' },
  )
  if (r.status === null || r.status >= 8) {
    console.error(`robocopy failed (exit code ${r.status})`)
    process.exit(1)
  }
}

// Regenerate android/ from app.json + plugins (never edited by hand).
run('npx expo prebuild --platform android --clean --no-install', buildRoot)
const androidDir = path.join(buildRoot, 'android')
// Full path: Windows may not run programs from the current folder by name.
const gradlew = path.join(androidDir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew')
try {
  // lintVital* is a Play Store pre-check; not needed for an APK shared directly (and it can lock files).
  run(`"${gradlew}" assembleRelease -x lintVitalAnalyzeRelease -x lintVitalReportRelease -x lintVitalRelease`, androidDir)
} finally {
  // Stop Gradle's background process so it doesn't keep build files locked for the next build.
  try {
    execSync(`"${gradlew}" --stop`, { cwd: androidDir, stdio: 'ignore' })
  } catch {
    // ignore
  }
}

const apk = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')
const outDir = path.join(root, '..', 'downloads')
fs.mkdirSync(outDir, { recursive: true })
fs.copyFileSync(apk, path.join(outDir, 'box-dispatch.apk'))
const now = new Date()
const pad = (n) => String(n).padStart(2, '0')
const builtAt = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
fs.writeFileSync(
  path.join(outDir, 'box-dispatch.json'),
  JSON.stringify({ version: app.version, versionCode: app.android.versionCode, built_at: builtAt }, null, 2),
)
const mb = (fs.statSync(apk).size / 1048576).toFixed(1)
console.log(`\nAPK ready: downloads/box-dispatch.apk (${mb} MB, version ${app.version} / ${app.android.versionCode})`)
console.log('Before the next release, raise "version" and "android.versionCode" in app.json so phones accept the update.')
