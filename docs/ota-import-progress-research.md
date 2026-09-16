# OTA findings for archive scan progress and support links

Research date: 2026-09-17

## Recommendation

Ship the requested changes as an EAS Update if they only change React Native
screens, text, styles, and JavaScript orchestration:

- An indeterminate "scanning" state or progress card can use the existing
  `backupDiscovery` and `backupProgress` APIs.
- A `mailto:` support action and a copy-address action can use the already
  installed `expo-linking` and `expo-clipboard` packages.

The implementation uses a Gmail compose HTTPS URL for the support link. This
opens Gmail's web compose flow; it does not guarantee that the native Gmail app
will handle the link. Expo documents `mailto:` as opening the operating
system's mail app, so Android or iOS may offer Gmail, another installed mail
app, or no handler. A Gmail-only native deep link would be a separate
compatibility decision.

If "scan progress" means exact per-archive or byte counts while Google Drive
scanning runs, this is not an OTA-only change in the current app. The scan is
implemented in the installed Android `ArchiveModule` native module, and its
`scanConnectedFolder` methods currently take no progress request and expose no
scan progress event. Adding that contract requires a new signed binary and a
new compatible runtime.

## Why the UI-only part is OTA eligible

Expo says EAS Update replaces non-native pieces such as JavaScript, styling,
and images, and users do not need to reinstall to receive an update. The
installed binary must contain the native runtime required by the update.
[EAS Update introduction](https://docs.expo.dev/eas-update/introduction/)

This checkout already has the relevant update setup in
[`app.json`](../app.json): version `1.1.5`, runtime version `1.1.5`, the EAS
Update URL, launch checks, and the production channel. The Android manifest
also contains the update URL, runtime metadata, and production channel
([`AndroidManifest.xml`](../android/app/src/main/AndroidManifest.xml)). The
dependencies [`expo-linking`](../package.json) and [`expo-clipboard`](../package.json)
are already present, so adding JavaScript calls to those existing modules does
not add a native dependency to this release.

The following are therefore OTA-eligible for a matching `1.1.5` binary:

| Change | OTA result |
| --- | --- |
| Render scan spinner, status text, disabled controls, or an indeterminate progress card | Yes |
| Subscribe to the existing discovery or backup-progress events | Yes, if the existing native event shape is enough |
| Add translations, layout, colors, or accessibility labels | Yes |
| Call `Linking.openURL('mailto:...')` | Yes, with mail-app behavior described above |
| Call `Clipboard.setStringAsync(...)` | Yes, using the installed module |

Expo's linking guide lists `mailto` as a common URL scheme and `Linking.openURL`
as the API for handing a URL to an installed app.
[Linking into other apps](https://docs.expo.dev/linking/into-other-apps/)
[Expo Linking API for SDK 54](https://docs.expo.dev/versions/v54.0.0/sdk/linking/)
Expo's SDK 54 clipboard reference documents `setStringAsync` on Android and
iOS.
[Expo Clipboard SDK 54](https://docs.expo.dev/versions/v54.0.0/sdk/clipboard/)

## What would require a new binary

The current native boundary is visible in
[`ArchiveModule.kt`](../android/app/src/main/java/com/roy/peacocknotes/ArchiveModule.kt)
and [`archive.ts`](../src/services/archive.ts). The Android module owns folder
listing and archive validation. Its scan methods return only after the scan and
currently do not accept a `BackupProgressOwner`. The existing progress bridge
in [`BackupFolderModule.kt`](../android/app/src/main/java/com/roy/peacocknotes/BackupFolderModule.kt)
can expose progress already produced by native operations, but it cannot make
the current scan emit new intermediate events by itself.

These changes need a new binary:

- adding native scan instrumentation, new native methods, or new native events;
- changing `ArchiveModule`, `BackupFolderModule`, `BackupProgress`, native
  package registration, Gradle, the manifest, permissions, or entitlements;
- adding a native dependency or changing the Expo/React Native native runtime;
- adding Android package-visibility queries or other native configuration for a
  Gmail-specific handler.

Expo's runtime-version rule is direct: when native code changes, publish a new
build before publishing an update. The runtime version prevents an update from
being sent to a binary whose native layer cannot support it.
[Runtime versions and updates](https://docs.expo.dev/eas-update/runtime-versions/)

For Android 11 and later, Expo also documents extra intent configuration when
an app needs to query handlers for common URL schemes. Avoid `canOpenURL` and
Gmail-specific routing for the simple support action unless that native
configuration is intentionally included in a binary release.
[Common URL schemes and Android intents](https://docs.expo.dev/linking/into-other-apps/)

## Release assumptions and gate

This finding assumes the target users have an Android binary built with
`expo-updates` and runtime `1.1.5`. Older binaries that do not contain
`expo-updates` cannot receive this EAS Update. The update must also avoid new
native dependencies and app-config changes that affect the installed native
layer.

Test the JavaScript-only revision on a matching preview build, then publish
the tested revision to the production channel. EAS Update targets builds using
platform, channel, and runtime constraints, and Expo recommends testing a
preview build with the same runtime before production.
[How EAS Update works](https://docs.expo.dev/eas-update/how-it-works/)
[Deploy updates](https://docs.expo.dev/eas-update/deployment/)

If exact native scan progress is required, make that a binary release first,
bump the app's runtime/version metadata, verify the event contract, and only
then use OTA for later UI and copy updates.
