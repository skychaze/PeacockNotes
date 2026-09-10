# Peacock Notes - Patch Notes

## Release
- Version: 1.0.6
- Version code: 7
- Built at: 2026-09-10 23:53:17 +0530
- APK: peacocknotes-v1.0.6-7.apk

## Updates
- Complete UI revamp built around a glass design language.
- Glass is everywhere: a floating top control cluster (circular back button + pill of actions), the editor's floating bottom bar (left tool pill + right overflow pill), the search bar, every bottom sheet and menu, and the folder tiles. Built on `expo-blur` with a RenderEffect blur on Android 12+, and roughly 90% transparent so the content beneath stays readable through the frost.
- New theme: warm paper canvas under a soft aurora gradient (peach, mint, periwinkle glows that drift almost imperceptibly), an emerald brand gradient on the FAB, and a warm near-black dark mode.
- Chrome disappears: borderless tonal cards, contained icon buttons, and no 1px borders on content.
- Folder tiles are translucent color glass. Each folder gets a deterministic accent tint from a set of eight, layered over the glass with a subtle top sheen.
- A custom floating top bar replaces the native header on all screens; the back button and actions are detached, and content scrolls beneath them.
- Notes list: frosted search pill, note cards with relative dates (Today / Yesterday) plus microphone and paperclip counts.
- Editor: borderless title and body inputs, audio cards with play/pause, animated waveform bars, and an animated progress fill. File rows now show image thumbnails (tap to open the full-screen viewer) and a PDF icon for PDFs.
- All modals are now bottom sheets: create/rename folder, sort, quick menu, note actions, audio actions, share-audio picker, and audio details. Scrim tap or Android back closes them, and each screen keeps exactly one sheet open.
- Motion: springy press feedback on every tappable, staggered list entrances, FAB pop-in, animated storage ring, self-drawing empty-state illustrations, and a drawn ring around the recording dot.
- Quality tiers: a device-aware module decides blur, ambient drift, and motion. Low-end or reduced-motion devices get a fully static fallback with solid fills and no blur.
- Typography: English now renders in the system font (SF Pro / Roboto) and Bengali in NotoSansBengali with Regular and SemiBold weights.
- Storage screen rebuilt with an animated usage ring and tinted breakdown rows with animated proportional bars.
- Share import screen rebuilt with file cards (name and size), folder and note selection, and a single import button.
- Splash screen updated to the Peacock Notes logo with theme-aware light and dark backgrounds.
- Bottom sheets are keyboard-aware: the create/rename sheets ride above the keyboard and return when it closes.

## Bug Fixes
- Fixed the folder naming sheet being hidden behind the keyboard on Android 15+ edge-to-edge devices.
- Fixed the folder grid collapsing a single folder to full width; it is now always a true two-column grid.
- Fixed the sheet open animation overshooting and bouncing; sheets now settle firmly without bounce.
- Fixed attachment ambiguity: image attachments show a thumbnail so two attachments can be told apart at a glance.
- Fixed the app launch flashing a placeholder logo.

## Known Issues
- Blur requires Android 12 (API 31) or newer. Older devices fall back to solid translucent panels by design.
- `expo-av` is deprecated in Expo SDK 54 and logs a warning at startup; migration to `expo-audio` is pending.
- An app that sends an unreadable content URI can still crash the native expo-share-intent parser (upstream bug, no JS-side guard).
- Pinch-to-zoom in the image viewer is not implemented.

## Notes
- Verified on an Android API 36 emulator: light and dark themes, both languages, folder and note create/edit/delete, sort and reorder, search, recording, playback, file attach/view/share, share import, storage usage, the reduced quality tier, and the cold-start splash.
- Release APK is signed with the Peacock Notes release keystore.
- `android/` remains generated and gitignored; rebuild with the compile-apk skill steps.
