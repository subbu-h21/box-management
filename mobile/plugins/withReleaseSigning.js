// Signs release builds with our own key (credentials/release.keystore) instead of the
// template's debug key. Android only installs an update over an existing app when both
// are signed with the same key, so that keystore must be kept safe and reused.
const fs = require('fs')
const path = require('path')
const { withAppBuildGradle } = require('expo/config-plugins')

const PROPS = path.join(__dirname, '..', 'credentials', 'keystore.properties')

const RELEASE_SIGNING = `
        release {
            // Added by plugins/withReleaseSigning.js
            def props = new Properties()
            def propsFile = file("../../credentials/keystore.properties")
            if (propsFile.exists()) {
                propsFile.withInputStream { props.load(it) }
                storeFile file("../../credentials/" + props["storeFile"])
                storePassword props["storePassword"]
                keyAlias props["keyAlias"]
                keyPassword props["keyPassword"]
            }
        }`

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (!fs.existsSync(PROPS)) {
      console.warn('[withReleaseSigning] credentials/keystore.properties not found: release build will use the debug key')
      return cfg
    }
    let gradle = cfg.modResults.contents
    if (!gradle.includes('Added by plugins/withReleaseSigning.js')) {
      gradle = gradle.replace(/signingConfigs\s*\{/, (m) => m + RELEASE_SIGNING)
    }
    // In the release build type, use the release key instead of the debug one.
    gradle = gradle.replace(
      /(release\s*\{[^{}]*?)signingConfig\s+signingConfigs\.debug/,
      '$1signingConfig signingConfigs.release',
    )
    cfg.modResults.contents = gradle
    return cfg
  })
}
