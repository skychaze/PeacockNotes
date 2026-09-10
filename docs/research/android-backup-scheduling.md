# Android backup scheduling guarantees and constraints

## Question and scope

GitHub [issue 4](https://github.com/skychaze/PeacockNotes/issues/4) asks what current Android and Expo APIs guarantee for approximately daily, network-gated backup after app closure, device restart, Doze, battery restrictions, and missed schedules. [Issue 1](https://github.com/skychaze/PeacockNotes/issues/1) supplies product context only: automatic cloud backup should happen approximately daily at the next Android-permitted opportunity with internet access, and the app should check for overdue work when it opens. This note does not change either issue.

This research covers Android only. It distinguishes Expo BackgroundTask from the deprecated Expo BackgroundFetch package and from WorkManager's public periodic-work model. Primary sources are the Expo SDK 54 documentation and source, current Android documentation, and this repository.

The repository declares `expo: ~54.0.0`; `package-lock.json` resolves it to **54.0.33**. It does not currently declare or lock `expo-background-task`, `expo-background-fetch`, or `expo-task-manager`. Expo SDK 54 recommends `expo-background-task ~1.0.10` and `expo-task-manager ~14.0.9` on their respective [BackgroundTask](https://docs.expo.dev/versions/v54.0.0/sdk/background-task/) and [TaskManager](https://docs.expo.dev/versions/v54.0.0/sdk/task-manager/) pages.

## Concise decision

Use Expo BackgroundTask, not BackgroundFetch, with `minimumInterval: 24 * 60`. Treat it as an opportunistic wake-up, never as a daily deadline. On Android, Expo's SDK 54 implementation schedules WorkManager work with a `CONNECTED` network constraint. WorkManager survives ordinary process death, app restarts, and device reboots, but Android may delay work for Doze, standby quotas, low battery policy, user battery restrictions, vendor policy, or force-stop. No API promises one backup per calendar day or catch-up of every missed daily occurrence.

Make the backup policy durable and app-owned. Store the last successful snapshot time, content revision or dirty state, and current attempt state. Every background wake-up and every app launch should run the same idempotent `backupIfDue()` operation. It should skip unchanged content, retry transient failures under an explicit app policy, and update the success timestamp only after the remote snapshot is complete and verified. Show the real last-success time and an overdue or blocked state in the UI.

## Findings

### Expo BackgroundTask is the supported Expo API

Expo SDK 54 marks [`expo-background-fetch` as deprecated](https://docs.expo.dev/versions/v54.0.0/sdk/background-fetch/#background-fetch). Expo says it receives no patches and will be removed in an upcoming release. Its Android-specific `stopOnTerminate` and `startOnBoot` options belong to that deprecated package. They are not options in BackgroundTask.

[`expo-background-task`](https://docs.expo.dev/versions/v54.0.0/sdk/background-task/) is for deferrable work outside the visible app lifecycle. It uses WorkManager on Android and TaskManager to execute JavaScript. Expo says a task runs sometime after its minimum interval if system conditions allow. The interval is inexact and is a lower bound, not a target time or deadline.

Expo's published SDK 54 page says the `minimumInterval` default is 12 hours. The tagged SDK 54 Android source instead defines [`DEFAULT_INTERVAL_MINUTES` as 24 hours](https://github.com/expo/expo/blob/sdk-54/packages/expo-background-task/android/src/main/java/expo/modules/backgroundtask/BackgroundTaskScheduler.kt#L27-L30). This inconsistency is another reason to set 1,440 minutes explicitly rather than rely on a default.

### Expo's Android implementation is not a plain periodic request on supported Android versions

Android's general [`PeriodicWorkRequest`](https://developer.android.com/reference/androidx/work/PeriodicWorkRequest) model has a 15-minute minimum interval. It runs inexactly, constraints can delay it, and Doze can delay it. Android also supports a flex interval near the end of each period. If constraints are not met within a run interval, Android says that run may be delayed or skipped in the [work-definition guide](https://developer.android.com/develop/background-work/background-tasks/persistent/getting-started/define-work#periodic).

Expo SDK 54 differs in an important implementation detail. On Android 8 and later, its [`BackgroundTaskScheduler`](https://github.com/expo/expo/blob/sdk-54/packages/expo-background-task/android/src/main/java/expo/modules/backgroundtask/BackgroundTaskScheduler.kt#L97-L131) enqueues a unique `OneTimeWorkRequest` with an initial delay. After the worker completes, Expo appends the next one-time request. The older periodic-request branch only applies below Android 8. Therefore, WorkManager's periodic flex-window behavior does not describe Expo's Android 8+ scheduling exactly. The user-facing Expo contract remains an inexact minimum delay.

The same [source](https://github.com/expo/expo/blob/sdk-54/packages/expo-background-task/android/src/main/java/expo/modules/backgroundtask/BackgroundTaskScheduler.kt#L23-L41) shows one native worker for the whole app. Expo's [multiple-task documentation](https://docs.expo.dev/versions/v54.0.0/sdk/background-task/#multiple-background-tasks) says every registered JavaScript background task runs through that worker and the last registered task determines the minimum interval. Peacock Notes cannot assume independently scheduled intervals for multiple Expo BackgroundTask jobs.

Expo also suppresses normal task execution while its activity is foregrounded. The [SDK 54 scheduler source](https://github.com/expo/expo/blob/sdk-54/packages/expo-background-task/android/src/main/java/expo/modules/backgroundtask/BackgroundTaskScheduler.kt#L199-L215) reschedules the worker instead. The overdue app-open path must therefore call the backup operation directly rather than wait for BackgroundTask.

### Network gating

Expo SDK 54 hardcodes [`NetworkType.CONNECTED`](https://github.com/expo/expo/blob/sdk-54/packages/expo-background-task/android/src/main/java/expo/modules/backgroundtask/BackgroundTaskScheduler.kt#L87-L95) on its WorkManager request. Android defines `CONNECTED` as requiring [any working network connection](https://developer.android.com/reference/androidx/work/NetworkType#CONNECTED). Expo BackgroundTask does not expose an option for unmetered, non-roaming, charging, idle, battery-not-low, or storage-not-low constraints.

This is suitable for issue 1's general internet requirement, including metered mobile data. It does not prove that Google authentication or Drive is reachable, and connectivity can disappear during an upload. WorkManager's [constraint rules](https://developer.android.com/develop/background-work/background-tasks/persistent/getting-started/define-work#constraints) say it stops a worker if a constraint becomes unmet and retries when all constraints are met. Backup code still needs resumable or restart-safe behavior because a network can fail at the application or service level while Android still considers it connected.

If the product wants Wi-Fi-only, unmetered-only, charging-only, or battery-not-low scheduling, Expo BackgroundTask's JavaScript API cannot express that. Peacock Notes would need to check such policy inside the task, accepting another delayed wake-up, or add native WorkManager integration with the desired constraints.

### App closure, process death, and force-stop are different conditions

WorkManager is intended for reliable work after the user leaves a screen, the app exits, or the device restarts. Android stores scheduled work in its own SQLite database and reschedules it after reboot, according to the [persistent-work overview](https://developer.android.com/develop/background-work/background-tasks/persistent#features).

Expo's [BackgroundTask lifecycle section](https://docs.expo.dev/versions/v54.0.0/sdk/background-task/#when-will-they-be-stopped) says system termination or reboot allows tasks to resume and allows the app to restart. Removing an Android app from recents normally does not fully stop it. Expo also warns that vendor behavior varies and some devices treat removal from recents as killing the app. Ordinary process death is therefore within the intended WorkManager case, but OEM behavior prevents a universal device-level promise.

A user force-stop is stronger. Android describes the stopped package state as persisting until direct or indirect user action launches or interacts with the app. Android 15 tightened this behavior and cancels pending intents while stopped; it delivers `BOOT_COMPLETED` only after user action removes the stopped state. See Android's [package stopped-state documentation](https://developer.android.com/about/versions/15/behavior-changes-all#package-stopped-state). No backup scheduler should claim to bypass force-stop. The app-open overdue check is the recovery path after the user starts Peacock Notes again.

Expo's wording that tasks stop if the user "kills the app" and resume after restart should not be read as a force-stop guarantee. It also notes that Android vendors interpret recents removal differently. Product text should distinguish normal closure from force-stop and battery restriction.

### Reboot persistence has limits

WorkManager's [persistent-work overview](https://developer.android.com/develop/background-work/background-tasks/persistent#features) explicitly says scheduled work persists and is rescheduled across device reboots. Expo likewise says tasks resume after system termination or reboot in its [lifecycle documentation](https://docs.expo.dev/versions/v54.0.0/sdk/background-task/#when-will-they-be-stopped).

That does not override stopped or restricted package rules. Android's [background optimization documentation](https://developer.android.com/topic/performance/background-optimization#user-initiated-restrictions) says that on Android 13 and later, an app that targets API level 33 or higher and is restricted does not receive `BOOT_COMPLETED` or `LOCKED_BOOT_COMPLETED` until another reason starts it. A force-stopped app also remains stopped until user interaction. Reboot persistence is therefore a normal-case guarantee, not a promise under user-imposed restrictions.

### Doze and app standby delay work

During Doze, Android blocks ordinary background network access and defers jobs, syncs, and standard alarms. It periodically opens maintenance windows and runs pending work with temporary network access. Maintenance windows become less frequent during prolonged inactivity. See the official [Doze and App Standby guide](https://developer.android.com/training/monitoring-device-state/doze-standby#understand_doze).

WorkManager follows these power-saving rules. Android's [power resource table](https://developer.android.com/topic/performance/power/power-details#device-state) says jobs are deferred to Doze maintenance windows and network is restricted during Doze. A daily backup may run in a later maintenance window, after the device wakes, or when charging begins. Exact execution during Doze is not guaranteed.

App Standby and standby buckets further limit jobs for infrequently used apps. Android's [standby-bucket guide](https://developer.android.com/topic/performance/appstandby) says bucket assignment affects job frequency while on battery. Current Android guidance allows restricted-bucket jobs only once per day in a batched session and notes that a restricted job does not run alone. The [power limits page](https://developer.android.com/topic/performance/power/power-details#app-stdby-bucket) labels its quota values approximate rather than guaranteed.

### Battery restrictions can block all scheduled work

On the default optimized setting, Android schedules work based on usage and system policy. A user can choose Restricted. Android's [background optimization page](https://developer.android.com/topic/performance/background-optimization#user-initiated-restrictions) says Restricted fully prevents background execution in its user-facing definition. On AOSP Android 9 and later, jobs do not execute in the restricted state. The exact restrictions depend on the device manufacturer.

Expo's BackgroundTask API does not provide a reliable Android status for this. In SDK 54, [`BackgroundTaskModule.getStatusAsync()` always returns `Available` on Android](https://github.com/expo/expo/blob/sdk-54/packages/expo-background-task/android/src/main/java/expo/modules/backgroundtask/BackgroundTaskModule.kt#L22-L24) because WorkManager exists. `Available` therefore does not mean Android will grant execution under current battery settings.

A daily backup is not an appropriate reason to request exemption from battery optimization. Android's [acceptable-use table](https://developer.android.com/training/monitoring-device-state/doze-standby#support_for_other_use_cases) limits direct exemption requests to narrow core-function cases. Ordinary periodic sync is not listed as acceptable.

### Timing, missed schedules, and retries

Neither Expo nor WorkManager guarantees one invocation per 24-hour calendar period. Expo says the task runs sometime after the minimum interval once required conditions hold. Android says periodic execution time depends on constraints and system optimization; a constrained periodic run may be skipped if conditions remain unmet during its interval. Expo's Android 8+ one-time chain also means its next interval is scheduled after the prior worker completes, so delay accumulates rather than producing fixed wall-clock slots.

There is no backlog of daily backups to replay. When execution finally becomes possible, the worker receives one opportunity. The application must decide whether a backup is overdue by comparing durable state with the current time. Creating several snapshots to represent days when no worker ran would invent history and should not happen.

Native WorkManager retries only when a worker returns `Result.retry()`, with configurable linear or exponential backoff. The default is exponential with a 30-second delay, as documented in [retry and backoff policy](https://developer.android.com/develop/background-work/background-tasks/persistent/getting-started/define-work#retries_backoff). A normal WorkManager worker can also be stopped when constraints disappear or when it exceeds the standard 10-minute deadline; Android schedules deadline-stopped work for later according to [worker stopping rules](https://developer.android.com/develop/background-work/background-tasks/persistent/how-to/manage-work#stop-worker).

Expo BackgroundTask exposes only `Success` and `Failed`, with no retry or backoff option. More importantly, SDK 54's [`BackgroundTaskWork`](https://github.com/expo/expo/blob/sdk-54/packages/expo-background-task/android/src/main/java/expo/modules/backgroundtask/BackgroundTaskWork.kt#L19-L37) returns WorkManager success after the JavaScript task callback completes and returns WorkManager failure only when an exception escapes native task execution. [`BackgroundTaskScheduler.runTasks`](https://github.com/expo/expo/blob/sdk-54/packages/expo-background-task/android/src/main/java/expo/modules/backgroundtask/BackgroundTaskScheduler.kt#L194-L238) schedules the next delayed request after completion. The Expo API and source do not support treating `BackgroundTaskResult.Failed` as a request for WorkManager `Result.retry()` with backoff. Peacock Notes must not rely on a failed result to produce a prompt retry.

If prompt retry after transient Drive failure is a requirement, choose one explicitly:

1. Keep the Expo-only design. Record failure durably, let the next background opportunity try again, and run `backupIfDue()` on app open. This is simpler but may leave a long gap.
2. Add a native WorkManager worker or module that returns `Result.retry()` and sets a backoff policy. This gives native retry semantics but adds native ownership of JavaScript startup, credentials, files, and cancellation.

In either design, cap each attempt well below WorkManager's ordinary 10-minute deadline or implement a supported long-running worker. Expo BackgroundTask does not expose WorkManager's long-running foreground-worker controls.

### Task definition and registration requirements

Call [`TaskManager.defineTask`](https://docs.expo.dev/versions/v54.0.0/sdk/task-manager/#taskmanagerdefinetasktaskname-taskexecutor) in global module scope, not in a React component or lifecycle method. Android may start the JavaScript application in the background without mounting views, run the task, and shut it down. The module containing the definition must load from the application's entry path before background dispatch.

Call [`BackgroundTask.registerTaskAsync`](https://docs.expo.dev/versions/v54.0.0/sdk/background-task/#backgroundtaskregistertaskasynctaskname-options) only after defining the same task name. Registration itself may happen from application code. Expo stores registrations persistently and restores them when the app initializes. TaskManager's [`isTaskRegisteredAsync`](https://docs.expo.dev/versions/v54.0.0/sdk/task-manager/#taskmanageristaskregisteredasynctaskname) can reconcile registration at startup.

Do not test this only in Expo Go. SDK 54's [TaskManager availability note](https://docs.expo.dev/versions/v54.0.0/sdk/task-manager/#taskmanagerisavailableasync) says TaskManager is unavailable in Expo Go on Android. Use a development build and a release-like APK. Expo's [`triggerTaskWorkerForTestingAsync`](https://docs.expo.dev/versions/v54.0.0/sdk/background-task/#backgroundtasktriggertaskworkerfortestingasync) is development-only and does not prove production scheduling timing.

## Guarantee and constraint matrix

| Condition | What Android or Expo guarantees | What is not guaranteed | Peacock Notes response |
| --- | --- | --- | --- |
| App UI closes or moves to background | WorkManager persists work outside the visible lifecycle. Expo runs BackgroundTask only when backgrounded. | Immediate execution or a particular wall-clock time. | Keep one persistent registration and make the task independent of mounted React UI. |
| Process is killed by Android | WorkManager is intended to run reliable work when the app process is not around. Expo says system-stopped tasks resume and the app may restart. | That memory state survives or every vendor behaves identically. | Read all policy, auth, dirty state, and snapshot inputs from durable storage. |
| Removed from Android recents | Standard Android behavior does not fully stop the app, according to Expo. | Some vendors treat removal as killing or stopping background work. | Do not claim a daily SLA. Show last successful backup and use app-open catch-up. |
| User force-stops app | Android keeps the package stopped until user interaction starts it again. | Any background task, reboot receiver, or network work while stopped. | On next launch, reconcile registration and immediately run the overdue check. |
| Device restarts | WorkManager persists and reschedules normal work across reboot. Expo says background tasks resume. | Execution while the package remains force-stopped or battery-restricted. Exact post-boot time is also not promised. | Preserve backup metadata durably and reconcile registration on the next app start. |
| Doze | Android eventually offers maintenance windows for deferred jobs and network work. | Execution at the 24-hour point, network outside maintenance windows, or a daily maintenance opportunity at a fixed time. | Accept the next permitted opportunity. Keep attempts bounded and restart-safe. |
| App Standby or rare use | Android still allocates limited job opportunities according to standby bucket and device state. | Daily timing. Current quota tables are approximate and policy may change. | Use the app-open overdue path and communicate staleness from the last success time. |
| Battery optimized | WorkManager participates in Android's battery-aware scheduler. | A fixed latency or exact interval. | Use the normal policy. Do not ask for battery exemption for routine backup. |
| User battery setting is Restricted | On affected Android versions and vendors, jobs can be blocked and boot delivery delayed. | Any background execution. Expo's Android `Available` status does not detect this block. | Explain likely restriction only after observed overdue failures. Provide settings guidance, not a forced exemption request. |
| No network at due time | Expo's WorkManager request waits for `CONNECTED`. | That one run occurs for each missed day or that Drive and authentication work once connected. | Attempt once when due and connected. Persist failure and remain overdue until verified success. |
| Network disappears during upload | WorkManager may stop work when its network constraint becomes unmet and later retry constraint-stopped work. | Atomic cloud upload, resumability, or correct handling of partial remote objects. | Upload to a temporary object or use resumable transfer, then publish or commit atomically. Make retry idempotent. |
| Schedule was missed for days | A later eligible wake-up may occur. App open is always an application-controlled opportunity. | Replay of each missed period or a strict upper bound on lateness. | Create at most one current snapshot when due and changed. Do not synthesize missed daily snapshots. |
| JavaScript task reports `Failed` | Expo records task completion through TaskManager and schedules its next delayed worker. | WorkManager retry with native backoff from the Expo result. | Store attempt outcome and choose an explicit app retry policy. |
| Worker exceeds normal deadline | WorkManager may stop an ordinary worker after 10 minutes and schedule it later. | Completion of a large SQLite, audio, and attachment upload in one invocation. | Build snapshot preparation and upload to resume safely, enforce a time budget, and consider native long-running work only if measurements require it. |
| Multiple Expo background tasks | Expo runs them through one native worker. | Independent schedules. The last registered task controls the interval. | Prefer one scheduler task that dispatches due jobs from durable state. |

## Implications and recommended architecture for Peacock Notes

1. Add `expo-background-task` and `expo-task-manager` using `npx expo install` so versions match installed Expo 54.0.33. Do not add deprecated `expo-background-fetch`.
2. Define one task, such as `peacock-cloud-backup`, in a module imported by `index.ts`. Define it at module scope before React mounts.
3. Register it with an explicit `minimumInterval: 1440`. Reconcile registration on startup rather than registering competing task names.
4. Put scheduling policy in one idempotent `backupIfDue(trigger)` function used by both the background task and app-open path. Serialize calls with a durable lease or transaction so foreground and background attempts cannot upload the same revision concurrently.
5. Persist at least `lastSuccessfulBackupAt`, `lastBackedUpContentRevision`, `attemptStartedAt`, `lastAttemptAt`, and a bounded failure classification. The schedule is based on the last verified success, not the last wake-up.
6. Return success for a clean no-op when content has not changed. When due work fails, persist the error and remain due. Do not assume Expo's `Failed` result requests a native retry.
7. Prepare a self-contained, immutable local snapshot before network upload. Upload from that stable artifact rather than reading a live SQLite database and changing attachments throughout a long transfer. Delete the local staging artifact only after remote verification or according to a safe cleanup policy.
8. Make cloud publication idempotent. A retry after process death, timeout, or lost connectivity must either resume the same snapshot or detect that it already completed. Partial uploads must not appear as valid snapshots.
9. On every app open, call the same operation if the last verified backup is overdue. This is the only dependable catch-up path after force-stop, severe battery restriction, or long scheduler delay.
10. Report facts in the UI: last successful backup time, whether local content has changed since then, whether an attempt failed, and whether backup is overdue. Avoid promising "backs up every day." Prefer "Android runs automatic backup when the app is due, in the background, and connected. Timing can be delayed by device settings."
11. Test a release-like development build with process kill, recents removal, reboot, forced Doze, App Standby, network loss during transfer, restricted battery mode, force-stop, and reopening. Android provides `adb shell dumpsys deviceidle force-idle` and standby commands in the [Doze test guide](https://developer.android.com/training/monitoring-device-state/doze-standby#testing_doze_and_app_standby); Expo documents [JobScheduler inspection commands](https://docs.expo.dev/versions/v54.0.0/sdk/background-task/#inspecting-background-tasks).

## Newly surfaced decisions

These decisions remain for the feature specification:

- **Retry latency.** Decide whether Expo's next opportunity plus app-open catch-up is enough. If not, approve native WorkManager retry support and define exponential backoff, retry caps, and terminal authentication errors.
- **Due threshold.** Define whether "daily" means 24 hours after the last verified successful changed-content snapshot, a local calendar-day rule, or another threshold. A duration is less surprising across time-zone and daylight-saving changes.
- **Metered data.** Expo BackgroundTask accepts any connected network. Decide whether audio and attachment backups may use metered or roaming data. A stricter policy needs an in-task check or native constraints.
- **Attempt time budget.** Set a safe maximum below the normal WorkManager 10-minute deadline. Decide what to do when a snapshot is too large to finish within it.
- **Resumability.** Choose the temporary-object naming, upload session persistence, remote commit marker, and cleanup behavior for interrupted uploads.
- **Battery restriction UX.** Decide when repeated overdue state justifies showing Android settings guidance. Do not infer permission from Expo's always-available Android status.
- **Manual backup.** Decide whether a user-initiated "Back up now" runs immediately in the foreground and how it coordinates with the background lease.
- **Sign-out and account changes.** Define when to unregister the task, clear credentials, preserve or discard overdue state, and prevent upload to the wrong Drive account.
- **Registration upgrades.** Define startup reconciliation after application update and task-name migration. Persistent registration still requires the matching global JavaScript definition in the shipped bundle.

## Sources

### Repository and issues

- Peacock Notes [`package.json`](../../package.json), Expo declaration `~54.0.0`
- Peacock Notes [`package-lock.json`](../../package-lock.json), resolved Expo version `54.0.33`
- GitHub [issue 4](https://github.com/skychaze/PeacockNotes/issues/4), research question
- GitHub [issue 1](https://github.com/skychaze/PeacockNotes/issues/1), accepted product context

### Expo SDK 54

- [Expo BackgroundTask, SDK 54](https://docs.expo.dev/versions/v54.0.0/sdk/background-task/)
- [Expo BackgroundFetch, SDK 54, deprecated](https://docs.expo.dev/versions/v54.0.0/sdk/background-fetch/)
- [Expo TaskManager, SDK 54](https://docs.expo.dev/versions/v54.0.0/sdk/task-manager/)
- Expo SDK 54 source: [`BackgroundTaskScheduler.kt`](https://github.com/expo/expo/blob/sdk-54/packages/expo-background-task/android/src/main/java/expo/modules/backgroundtask/BackgroundTaskScheduler.kt)
- Expo SDK 54 source: [`BackgroundTaskWork.kt`](https://github.com/expo/expo/blob/sdk-54/packages/expo-background-task/android/src/main/java/expo/modules/backgroundtask/BackgroundTaskWork.kt)
- Expo SDK 54 source: [`BackgroundTaskConsumer.kt`](https://github.com/expo/expo/blob/sdk-54/packages/expo-background-task/android/src/main/java/expo/modules/backgroundtask/BackgroundTaskConsumer.kt)
- Expo SDK 54 source: [`BackgroundTaskModule.kt`](https://github.com/expo/expo/blob/sdk-54/packages/expo-background-task/android/src/main/java/expo/modules/backgroundtask/BackgroundTaskModule.kt)
- Expo SDK 54 source: [`BackgroundTask.types.ts`](https://github.com/expo/expo/blob/sdk-54/packages/expo-background-task/src/BackgroundTask.types.ts)

### Android

- [Persistent work and WorkManager](https://developer.android.com/develop/background-work/background-tasks/persistent)
- [Define WorkRequests, periodic work, constraints, and retries](https://developer.android.com/develop/background-work/background-tasks/persistent/getting-started/define-work)
- [Manage and stop WorkManager work](https://developer.android.com/develop/background-work/background-tasks/persistent/how-to/manage-work)
- [`PeriodicWorkRequest` reference](https://developer.android.com/reference/androidx/work/PeriodicWorkRequest)
- [`NetworkType` reference](https://developer.android.com/reference/androidx/work/NetworkType)
- [Doze and App Standby](https://developer.android.com/training/monitoring-device-state/doze-standby)
- [App Standby Buckets](https://developer.android.com/topic/performance/appstandby)
- [Power management resource limits](https://developer.android.com/topic/performance/power/power-details)
- [Background optimization and user restrictions](https://developer.android.com/topic/performance/background-optimization)
- [Android 15 package stopped-state behavior](https://developer.android.com/about/versions/15/behavior-changes-all#package-stopped-state)
