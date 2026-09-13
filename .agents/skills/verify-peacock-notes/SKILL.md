---
name: verify-peacock-notes
description: Drive Peacock Notes, the local-first Expo Android note app, the way a user does on the emulator via agent-device. Use to prove any behavior change end to end with screenshots.
---

# Verify Peacock Notes

Peacock Notes is a local-first note app (Expo React Native, `App.tsx`). The only
drivable surface in this environment is the **Android app on the emulator**.
Web is not installed (`npx expo start --web` fails: `react-dom` and
`react-native-web` are missing; do not add them just to verify). iOS is
configured (`ios/`, bundle `com.roy.peacocknotes`) but there is no macOS host
here. Cover Android, note the rest as out of scope.

## Launch

Prerequisites: Android SDK with `adb` on PATH, emulator `emulator-5554`
booted (`adb devices` shows it). Never drive the physical vivo device; it is
the user's phone. All helper invocations run from the repo root.

The emulator build is an Expo **dev build**: it shows a white screen until
Metro serves the JS bundle, and it always serves port 8081 (one Metro per
machine, no parallel verification runs). Start Metro first, then the app:

```bash
.agents/skills/verify-peacock-notes/scripts/metro.sh start
SERIAL=emulator-5554 .agents/skills/verify-peacock-notes/scripts/launch.sh
```

`launch.sh` installs the newest `releases/v*/peacocknotes-*.apk` (or takes an
APK path). If the emulator copy has a different signing key it prints
`LAUNCH WARN` and keeps the installed build without wiping data; `doctor.sh`
then reports which version is actually installed. The app is ready when the
Folders screen renders: after a cold start the first bundle build takes
40-60s, so `wait text "Folders"` after switching to English (below) before
touching anything.

Single driver only: if `agent-device open` fails with `DEVICE_IN_USE`, stop
and report. Do not close another session's lock; a stale lock (no session
activity for hours) may be released with `agent-device close --session
<stale-id>` after checking its session dir mtimes, nothing else.

Teardown (kills only what this run started; evidence dirs are never touched):

```bash
SERIAL=emulator-5554 .agents/skills/verify-peacock-notes/scripts/teardown.sh
# then: agent-device close  (with your own --platform/--serial/--config/--session flags)
```

## Doctor

Run first whenever anything looks off. Read-only.

```bash
SERIAL=emulator-5554 .agents/skills/verify-peacock-notes/scripts/doctor.sh
```

It checks the emulator is booted, the package is installed, the installed
`versionName` matches `app.json`, and Metro is serving on :8081. `DOCTOR OK`
means the instance is worth driving. A white screen with `DOCTOR OK` means
the bundle is still building: wait for Metro's `Android Bundled` line, then
re-snapshot. Fast static checks (`npm run typecheck`, `npm test`) are
optional companions, not a substitute for driving the app.

## Drive

Harness is the `agent-device` CLI. Get your flags from `device_open`
(`--platform android --serial emulator-5554 --config <path> --session
<id>`); keep them on every call. Typical loop:

```bash
agent-device open com.roy.peacocknotes --foreground   # ... + your flags
agent-device snapshot -i                              # ... + your flags
agent-device click @eN --settle                       # ... + your flags
agent-device fill @eN "text" --settle                 # ... + your flags
agent-device wait text "Expected"                     # ... + your flags
agent-device screenshot <evidence-dir>/shot.png       # ... + your flags
```

Prefer snapshot `@ref`s and visible text over coordinates. Refs from a
`--settle` diff frame are often rejected: capture a fresh `snapshot -i`
before `fill`/`click` and keep the `~sN` pin it returns. App specifics:

- A React Native dev-warning overlay may cover the screen on fresh bundles.
  Dismiss it first: `agent-device react-native dismiss-overlay`, then
  re-snapshot.

- The app may start in Bengali (device locale). Tap the `EN` language button
  in the top bar first so all strings below match.
- Folders screen header is `Folders`. The create FAB opens the `New Folder`
  sheet with an `Enter folder name` field and a `Create` button. Folder cards
  show `{count} notes`; tapping one opens its notes list.
- Notes list has a `Search notes` field and a `+` FAB that opens the editor.
- Editor fields are `Note title` and `Write your note here...`; saving needs a
  non-empty title (`Missing name` alert otherwise).
- The feature map in `features/` lists every route with exact strings and
  proof states. Scratch data must use names starting with `VERIFY-` so
  cleanup can find it, and cleanup deletes it (delete folder removes its
  notes; see `features/folders.md`).

## Evidence

Each run writes to `artifacts/verify/<YYYYMMDD-HHMMSS>/` (local only, never
committed): at least one screenshot of the action, one of the resulting
state, and the `snapshot -i` text of the final state. Name files so the
feature is obvious (`folders-create.png`, `final.snapshot.txt`).

Proof standards: exercise the real user path through the UI, never internal
setters or test-only endpoints. Capture the action and the resulting state,
not just the final screen. Verify side effects alongside what is visible
(reopen the screen, search for the created item, check counts change).
External boundaries (Google Drive backup folder, share sheet targets) are the
only acceptable mocks, and only where the app already isolates them.

## Cleanup

1. Delete every `VERIFY-` folder/note the run created, through the UI.
2. Run `scripts/teardown.sh` (force-stops only `com.roy.peacocknotes`).
3. Close your own agent-device session. Never close another session, never
   touch the physical device, never `adb kill-server`.
4. Confirm the `artifacts/verify/<run>/` proof files still exist. A cleanup
   that eats the proof fails the run.

## Helpers

- `scripts/metro.sh` (executable): `./scripts/metro.sh start|stop|status`
- `scripts/doctor.sh` (executable): `SERIAL=emulator-5554 ./scripts/doctor.sh`
- `scripts/launch.sh` (executable): `SERIAL=emulator-5554 ./scripts/launch.sh [apk]`
- `scripts/teardown.sh` (executable): `SERIAL=emulator-5554 ./scripts/teardown.sh`
  (also stops the Metro instance this run started)

All three take `SERIAL` (default `emulator-5554`) and run from the repo root.
