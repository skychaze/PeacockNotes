# UI redesign plan (v3, implementation-ready)

This document is the complete brief for redesigning the app's UI. It is written so
any engineer or model can execute it end to end without asking further questions.
Read it fully before touching code. Sections 4, 5, and 13 are normative. If prose
and code snippets disagree, the code snippets win.

Version history, so the tradeoffs are clear:

- v1 aimed for a fully flat, Bear-style neutral look.
- v2 added the current direction: vibrant accents, atmospheric gradient
  background, glass overlays, springy motion, SVG draw effects.
- v3 makes it executable: adds the quality tier system with `expo-device`,
  fixes the Android glass approach (no RN `Modal` for sheets), pins the exact
  font source, adds exact interfaces and reference implementations, and lists
  the known pitfalls.

## 1. Goal and non-goals

Goal: make the app look modern, minimal, and alive. Today it looks generated:
decorative background blobs, a bright orange drawer with random circles, 1px borders
on every card, one font for all languages, sort controls permanently occupying screen
space, and centered alert-style modals.

What "modern, minimal, vibrant" means concretely for this app:

- A calm warm canvas lifted by a soft aurora gradient. Atmosphere is one coherent
  system, not loose decorations.
- Vivid color lives in the content: folder tints, brand gradient on the FAB and
  primary actions, glowing progress.
- Chrome disappears: borderless tonal cards, no outlined boxes, no naked icon rows.
- Glass on overlays only: bottom sheets, search bar, editor bottom bar.
- Motion everywhere it helps: every press springs, lists enter with a stagger,
  the background drifts almost imperceptibly, illustrations draw themselves on.
- The design adapts to the device instead of assuming flagship hardware. See
  section 5.

Non-goals:

- No database schema changes. No navigation route or param changes.
- No changes to recording, playback, file handling, share intent, or storage logic.
- No new product features. Reorder, sort, search, rename, delete, append-audio and
  every existing behavior must keep working exactly as today.
- Exactly four new runtime dependencies, listed in section 9. No others.

## 2. Reference board and what to take from each

Research was done on 2026-09-10. These are the references, ranked by importance.

1. Google Keep, Material 3 Expressive redesign (shipped Aug 2025)
   https://9to5google.com/2025/08/21/google-keep-material-3-expressive-redesign/
   Take: the thick pill search bar as the main header element, contained circular
   and rounded-square icon buttons instead of naked icons, a bottom action bar in
   the editor, springy press feedback. Buttons sit inside tonal containers, not on
   bare backgrounds.

2. Zoho Notebook
   https://www.zoho.com/notebook/features.html and Play Store listing
   (com.zoho.notebook). Closest feature match to this app: notebooks (folders),
   note cards, audio cards, file cards. Take: color-coded surfaces. Each folder
   gets a vivid tint. Content carries the color, app chrome stays neutral.

3. Bear (Apple Design Award 2017)
   https://bear.app/
   Take: typographic restraint. Large titles, generous line height, chrome that
   disappears when you write. The editor is the product.

4. Apple Notes
   Take: list density, relative timestamps, actions hidden behind long-press and
   overflow menus instead of always-visible icon rows.

5. Dribbble notes-app gallery (current trends)
   https://dribbble.com/tags/notes-app
   Observed patterns: pastel aurora backgrounds with a single saturated brand
   accent, frosted glass overlays, borderless tonal cards, oversized screen titles,
   warm near-black dark themes. Do not copy any single shot. Trends only.

The synthesis: warm canvas under a soft aurora gradient, strong typography, vivid
folder tints, one emerald-teal brand gradient, glass overlays, contained buttons,
bottom sheets, springy press states, self-drawing illustrations. Bear's calm type,
Keep's controls, Notebook's color, current-trend atmosphere.

## 3. Current state map

Files that define the look today:

- `src/theme/colors.ts` exports `PeacockTheme` with 9 tokens including `card`,
  `secondary`, and `accent`. `PeacockTheme` is referenced nowhere else.
- `src/theme/ui.ts` radius, space, font scales. Keep the shape, change values.
- `src/theme/useAppColors.ts` hook returning `{ isDark, colors }`. No changes.
- `src/theme/contrast.ts` exports `getContrastColor(backgroundColor, darkColor,
  lightColor)`. Keep using it.
- `src/components/ScreenContainer.tsx` is the safe-area background wrapper. It has
  two hardcoded decorative blobs. Remove them and render `Atmosphere` instead.
- `src/components/EmptyState.tsx` takes `{ iconName, title, subtitle }`.
- `src/components/PrimaryButton.tsx` takes `{ onPress, disabled, children }`.
- `src/components/LanguageToggleButton.tsx` takes no props and uses `useLanguage`.
- Screens: `FoldersScreen.tsx` (855 lines, contains the orange drawer and three RN
  Modals), `NotesListScreen.tsx` (411), `NoteEditorScreen.tsx` (2044, audio groups,
  file attachments, recording UI, rename/details modals), `ShareImportScreen.tsx`,
  `StorageUsageScreen.tsx`.
- i18n: `src/i18n/translations.ts` with `bn` and `en`. `useLanguage()` from
  `src/i18n/LanguageContext.tsx` returns `{ language, isLanguageReady,
  setLanguage, toggleLanguage, t }`. All user-facing strings go through `t()`.
- `src/utils/` already exists (`audioFormat.ts`, `fileFormat.ts`, `mediaFiles.ts`).
  Add `dateFormat.ts` there.
- Font: only `NotoSansBengali-Regular.ttf` is bundled and it is applied to every
  Text element including English. See section 6.
- Token usage to sweep in phase 1: `colors.card` 30 times in 6 files,
  `colors.accent` 7 times, `colors.secondary` 6 times (both only in
  `NoteEditorScreen.tsx`, `ScreenContainer.tsx`, and `App.tsx`). Replacements are
  in section 4.1. `colors.border` and `colors.error` keep their names.
- Installed already: reanimated 4, gesture-handler, safe-area-context, async
  storage. Not installed: gradients, blur, SVG, device info. See section 9.

## 4. Design tokens

Replace the contents of `src/theme/colors.ts` and `src/theme/ui.ts` with the
tokens below. Keep the exported names `ThemeColors`, `getThemeColors`, and `ui`.
Rename `PeacockTheme` to `AppTheme` (contained inside `colors.ts`), and rename the
`card` token to `surface` everywhere.

### 4.1 Color

Exact type:

```ts
export type ThemeColors = {
  background: string;
  backgroundDeep: string;
  surface: string;
  surfaceVariant: string;
  glass: string;
  glassBorder: string;
  text: string;
  textSecondary: string;
  primary: string;
  primaryBright: string;
  onPrimary: string;
  gradient: [string, string];
  border: string;
  error: string;
  atmosphere: [string, string, string];
  atmosphereOpacity: number;
};
```

Light values:

| token | value | use |
|---|---|---|
| background | `#F7F6F2` | warm paper |
| backgroundDeep | `#EFF1EC` | base gradient second stop |
| surface | `#FFFFFF` | cards, sheets, solid glass fallback |
| surfaceVariant | `#EEEDE7` | chips, icon button fill, meta rows |
| glass | `rgba(255,255,255,0.70)` | translucent fill over BlurView |
| glassBorder | `rgba(25,25,23,0.08)` | hairline edge on glass |
| text | `#191917` | primary text |
| textSecondary | `#5F5F59` | previews, meta, icons |
| primary | `#0A7D62` | solid brand, 5.0:1 against white |
| primaryBright | `#12B58C` | accents, glow, gradient stop |
| onPrimary | `#FFFFFF` | text and icons on primary |
| gradient | `['#0FA37B', '#0A7D62']` | FAB fill |
| border | `#E4E3DC` | hairlines only, never default on cards |
| error | `#B3261E` | destructive |
| atmosphere | `['#FFD9BC', '#BDEBDC', '#CBDCFB']` | peach, mint, periwinkle glows |
| atmosphereOpacity | `0.50` | glow layer opacity |

Dark values:

| token | value | use |
|---|---|---|
| background | `#121214` | warm near-black |
| backgroundDeep | `#0C0D10` | base gradient second stop |
| surface | `#1C1C1F` | cards, sheets |
| surfaceVariant | `#28282C` | chips, icon button fill |
| glass | `rgba(26,26,29,0.72)` | translucent fill over BlurView |
| glassBorder | `rgba(255,255,255,0.10)` | hairline edge on glass |
| text | `#F2F2ED` | primary text |
| textSecondary | `#A5A59F` | previews, meta, icons |
| primary | `#4FD1A5` | bright mint, carries dark ink |
| primaryBright | `#7FE8C4` | accents, glow |
| onPrimary | `#04231A` | text and icons on primary |
| gradient | `['#5ADBB4', '#35B89C']` | FAB fill |
| border | `#303036` | hairlines |
| error | `#F2B8B5` | destructive |
| atmosphere | `['#0B4A42', '#182D57', '#361C40']` | teal, indigo, plum glows |
| atmosphereOpacity | `0.55` | glow layer opacity |

Token migration for the sweep:

- `colors.card` becomes `colors.surface`.
- Filled surfaces that carry text (today the copy/share buttons in the editor use
  `primary`, `secondary`, and `accent`) become `colors.primary` with
  `colors.onPrimary` text. Do not put white text on `primaryBright`: `#12B58C`
  with white is about 2.9:1, well under 4.5.
- `colors.accent` becomes `colors.primaryBright` only where it is an icon, dot,
  or border with nothing written on top.
- `colors.secondary` maps the same way: `colors.primary` when text sits on it,
  `colors.error` for the recording red dot.
- Recording controls use `colors.primary`.
- `colors.border` and `colors.error` keep their names.
- The `notification` field in the App.tsx navigation theme uses
  `colors.primaryBright`.

### 4.2 Folder accent tints

Folders have no color column and none may be added. Derive deterministically:

```ts
const accent = FOLDER_ACCENTS[Math.abs(Number(folder.id)) % FOLDER_ACCENTS.length];
const tint = isDark ? accent.dark : accent.light;
const ink = isDark ? accent.inkDark : accent.inkLight;
```

Export from `colors.ts`:

```ts
export type FolderAccent = {
  light: string;
  inkLight: string;
  dark: string;
  inkDark: string;
};

export const FOLDER_ACCENTS: FolderAccent[] = [
  { light: '#FFE3D8', inkLight: '#B23A1A', dark: '#3B2620', inkDark: '#FFB49A' }, // coral
  { light: '#FFEDC9', inkLight: '#94620A', dark: '#382E1C', inkDark: '#FFD28A' }, // amber
  { light: '#EDF4C2', inkLight: '#5F7010', dark: '#2F3418', inkDark: '#D8E37E' }, // lime
  { light: '#D2F2DD', inkLight: '#176B3D', dark: '#1E3327', inkDark: '#8EE8AE' }, // emerald
  { light: '#D5ECFB', inkLight: '#1B6392', dark: '#1F2F3A', inkDark: '#9CD8F5' }, // sky
  { light: '#E4DFFF', inkLight: '#5340C9', dark: '#2A2740', inkDark: '#C4B9FF' }, // iris
  { light: '#FDDBEB', inkLight: '#A52C68', dark: '#3A2430', inkDark: '#FFA8CE' }, // rose
  { light: '#D0F0EC', inkLight: '#0E6E66', dark: '#1D3230', inkDark: '#7FE0D4' }, // teal
];
```

Contrast rule: ink on its tint must be at least 4.5:1 for text and 3:1 for glyphs.
The pairs above clear it; verify in the polish phase using `getContrastColor` or a
one-off luminance check.

### 4.3 Typography

`ui.type` is the named scale that `AppText` consumes. The numeric `ui.font` keys
stay during the transition and are deleted in the polish phase once all screens
use `AppText`.

| variant | size | weight | line height | use |
|---|---|---|---|---|
| display | 32 | 700 | 38 | screen titles |
| title | 22 | 700 | 28 | card titles, sheet headers |
| headline | 17 | 600 | 22 | card titles, button labels |
| body | 16 | 400 | 24 | default text |
| bodySmall | 14 | 400 | 20 | previews, meta |
| caption | 12 | 500 | 16 | timestamps, chips |

Editor text: title 28 weight 700, body 17 weight 400 line height 26.

### 4.4 Spacing, radius, elevation, glass

- space: xs 4, sm 8, md 12, lg 16, xl 20, xxl 24, xxxl 32. Screen padding 16.
- radius: sm 8, md 12, lg 16, xl 24, sheet 28, fab 18, pill 999.
- Cards have no border and no shadow. Separation comes from background versus
  surface. The atmosphere shows through gutters, never under an opaque card.
- FAB and the editor bottom bar keep a soft shadow: opacity 0.12, radius 12,
  offset y 4, elevation 6.
- Glass surfaces render `BlurView` at intensity 45 light and 35 dark, with the
  `glass` fill over it, a `glassBorder` hairline, and `overflow: 'hidden'` for the
  radius. When blur is not active, the fill becomes `surface` (or a caller-provided
  fallback color) so text stays readable. Glass is allowed only on bottom sheets,
  the notes search bar, and the editor bottom bar. Never on list cards.

### 4.5 Atmosphere

`src/components/Atmosphere.tsx` renders behind all content:

1. A base vertical `LinearGradient` from `background` to `backgroundDeep`.
2. Three glow circles, each `width * 0.9` across, filled with a `LinearGradient`
   from one `atmosphere` color to `${color}00` (same color, alpha 0). Use the
   8-digit hex, not the word `transparent`, to avoid gray banding.
   Positions relative to screen width:
   - glow 0: top `-width * 0.35`, left `-width * 0.25`
   - glow 1: top `-width * 0.15`, right `-width * 0.35`
   - glow 2: bottom `-width * 0.40`, left `width * 0.05`
3. Opacity `atmosphereOpacity`, `pointerEvents="none"`.
4. Drift on the UI thread: each glow translates plus or minus 10 px and scales
   1.00 to 1.06 over 18 s, 24 s, and 30 s, ease in-out, `withRepeat` mirror.
   Static when `useQuality().ambientDrift` is false.
5. `useWindowDimensions()` supplies the width. Recompute sizes on rotation.

### 4.6 Motion

Reanimated 4 is installed. Spec:

- Press: scale to 0.97 and spring back, damping 15, stiffness 260. One wrapper,
  `PressableScale`, used by every tappable.
- Entrance: opacity 0 to 1 and translateY 12 to 0 over 300 ms, staggered 40 ms
  per item, capped at index 8. Use `FadeInDown.duration(300).delay(Math.min(index,
  8) * 40)`. Mount only, never on re-render.
- FAB: scale 0.7 to 1 with spring damping 12, stiffness 220, delayed 150 ms.
- Bottom sheets: panel translateY with spring damping 18, stiffness 220; scrim
  opacity to 0.4 over 200 ms; dismiss reverses over 200 ms before unmount.
- Draw effects: `AnimatedRing` animates to the real value over 900 ms
  `Easing.out(Easing.cubic)`; `EmptyArt` draws strokes over 700 to 900 ms with a
  per-path stagger; playing audio animates `AnimatedBars`.
- Existing recording pulse and equalizer animations stay. Add a drawn ring around
  the recording dot.
- No shared-element or layout animations in this pass.
- When `motionEnabled` is false, entrance and drift are skipped, ring and art
  render at their final state, playing bars render static, sheets still open but
  with a 150 ms timing fallback, and press scale still applies (it is direct
  manipulation).

## 5. Quality tiers and device fallbacks

The design must not assume flagship hardware. One module owns every decision:
`src/theme/quality.ts`. No other file checks device specs or `Platform.Version`.

Signals:

- `Platform.OS`, `Platform.Version` (Android API level as a number).
- `expo-device`: `Device.platformApiLevel` (Android, else null),
  `Device.deviceYearClass`, `Device.totalMemory` (bytes), `Device.isDevice`.
- `useReducedMotion()` from reanimated (OS accessibility setting).
- Probe result persisted in AsyncStorage under `ui.quality.probe.v1` with values
  `'full'` or `'reduced'`.

Base rules, computed once at module load:

```
blurSupported  = iOS || apiLevel >= 31        // RenderNode path
specsHandleDrift = iOS || yearClass >= 2019 || totalMemory >= 6 GiB
```

- Null spec values count as capable, so web and emulators default to full.
- Blur is capability-gated only. Low RAM does not disable it; old Android does,
  because that selects the slow RenderScript path.
- Specs only seed `ambientDrift`.

Runtime rules:

- A stored or live `'reduced'` probe result disables `blurEnabled` and
  `ambientDrift`.
- `useReducedMotion()` disables `ambientDrift` and `motionEnabled`, never blur.
- `QUALITY_OVERRIDE` at the top of `quality.ts`, typed
  `'auto' | 'full' | 'reduced'`, default `'auto'`. `'reduced'` forces blur, drift,
  and motion off and ignores stored results. `'full'` ignores stored results. This
  is the manual test switch; flip it in phase 9 to verify both tiers visually.

The probe, once per install:

- Skips when `__DEV__`, when `Device.isDevice` is false, when
  `QUALITY_OVERRIDE !== 'auto'`, when storage already holds a result, or when the
  base rules already disabled drift (nothing to protect).
- Starts 3 s after `QualityProvider` mounts, measures 6 s with
  `useFrameCallback`, counts frames where `timeSincePreviousFrame > 32` ms.
- Downgrades when at least 120 frames were sampled and more than 15 percent were
  slow. Persists `'full'` or `'reduced'`; applies immediately on downgrade and
  never upgrades an existing `'reduced'`.

Consumption: `useQuality()` returns `{ blurEnabled, ambientDrift, motionEnabled }`.
`GlassSurface`, `Atmosphere`, entrance helpers, and the sheets read it. Screens do
not.

## 6. Typography and language-aware fonts

Today every Text uses `NotoSansBengali`, including English UI. That is the single
biggest "one font everywhere" tell. Fix:

- Bengali (`bn`): NotoSansBengali Regular (bundled) and NotoSansBengali SemiBold
  (add). Weights 400 use Regular, 500 to 700 use SemiBold.
- English (`en`): system font, `fontFamily: undefined`, `fontWeight` carries the
  weight. SF Pro on iOS, Roboto on Android. Do not bundle Inter.

Create `src/components/AppText.tsx` with props
`TextProps & { variant?: TypeVariant; color?: string }`. Default variant `body`,
default color `colors.text`. It reads `useLanguage()` and `useAppColors()` and maps
the variant to fontSize, lineHeight, and fontFamily. Exact code in section 13.3.

Export a helper from the same file for `TextInput` and other native text surfaces
that cannot use `AppText`:

```ts
export const getFontFamily = (language: Language, weight: TypeToken['weight']) =>
  language === 'bn'
    ? weight === '400' ? 'NotoSansBengali' : 'NotoSansBengali-SemiBold'
    : undefined;
```

Replaces every raw `<Text>` in screens and components with `<AppText>`. This is
mechanical. The string literal `'NotoSansBengali'` may appear only inside
`AppText.tsx`, `getFontFamily`, and the `Font.loadAsync` plus `headerTitleStyle`
wiring in `App.tsx`.

The native stack header title cannot use `AppText`. In `AppNavigator`, derive it
from `language`:

```ts
headerTitleStyle: {
  fontFamily: language === 'bn' ? 'NotoSansBengali-SemiBold' : undefined,
},
```

## 7. Component primitives

Build these in `src/components/`. Exact code for the starred items is in section
13.

1. `AppText` (starred). Variant and color aware Text.
2. `PressableScale` (starred). Reanimated press spring. Restrict its `style` prop
   to `StyleProp<ViewStyle>` so the animated style array stays valid. Forwards all
   other `PressableProps`.
3. `Atmosphere` (starred). Section 4.5. Used by `ScreenContainer`.
4. `GlassSurface` (starred). Props
   `{ radius: number; blurOn?: 'all' | 'ios'; intensity?: number;
   fallbackColor?: string; style?; contentStyle?; children }`. Renders BlurView
   only when `quality.blurEnabled` and platform allows; otherwise the fallback
   fill. `blurOn: 'ios'` is for the search bar (see section 8 and pitfall 2).
5. `Card`. Borderless, `surface` background or an optional `tint`, radius lg,
   padding 16. With `onPress` it wraps content in `PressableScale`; without, a
   plain View.
6. `SearchBar`. Height 52, radius pill, `GlassSurface` with `blurOn="ios"` and
   `fallbackColor={colors.surfaceVariant}`. Leading magnify icon 22 in
   textSecondary, `TextInput` flex 1 using `getFontFamily` and body size,
   placeholder textSecondary. Trailing clear `IconButton` when text is non-empty.
7. `FAB`. 56x56, radius 18, `LinearGradient` with `colors.gradient`
   (`start={{ x: 0, y: 0 }}`, `end={{ x: 1, y: 1 }}`), onPrimary icon at 26,
   soft shadow. Entrance pop per 4.6.
8. `IconButton`. 40x40, radius pill or 12 (`square` prop), `surfaceVariant` fill,
   icon 22 in text color. `danger` renders the icon in error color. Accepts
   `icon: keyof typeof MaterialCommunityIcons.glyphMap`.
9. `Chip`. Height 34, radius pill, caption text. Selected: primary background,
   onPrimary text. Unselected: surfaceVariant, text color.
10. `BottomSheet` (starred). In-tree absolute overlay, NOT an RN `Modal` (see
    pitfall 1). Scrim 0.4 closes on press, Android back closes via `BackHandler`
    registered only while the screen is focused (`useIsFocused`). Panel is a
    `GlassSurface` with radius sheet on the top corners, drag handle 36x4 centered
    at top, optional title in `title` variant. `KeyboardAvoidingView` wraps the
    panel. Rendered last in the screen tree, after the FAB.
11. `ActionSheet`. `BottomSheet` with a list of rows
    `{ icon, label, destructive?, onPress }`. Row height 52, icon 22 in
    textSecondary or error, label headline. Tapping a row closes the sheet, then
    runs the action after the close animation so any follow-up Alert is not shown
    under an open sheet.
12. `AnimatedRing` (starred). SVG progress ring with center slot. Used by
    StorageUsage and the recording indicator.
13. `AnimatedBars` (starred). Small waveform of 5 to 7 rounded Views animated
    with reanimated `scaleY` loops while playing, static heights when idle. Used
    in the editor audio cards while a group plays, nowhere else.
14. `EmptyArt` (starred). SVG illustration, viewBox 120x120, stroke
    `currentColor`, strokeWidth 4, round caps, no fill. Variants: `folders`,
    `notes`, `search`, `generic`. Draws strokes on mount with a per-path stagger,
    then floats gently. Suggested shapes are simple: folder tab outline, two
    overlapping pages with three lines, magnifier circle plus handle.
15. `EmptyState`. Keep the existing props `{ iconName, title, subtitle }` so call
    sites stay unchanged. Map `iconName` to an `EmptyArt` variant with a lookup
    object defaulting to `generic`. Layout: 96 px `surfaceVariant` circle holding
    the 56 px art, title in title variant, subtitle in bodySmall textSecondary,
    all centered.
16. `PrimaryButton`. Keep props `{ onPress, disabled, children }`. Height 48,
    radius pill, primary background with a `LinearGradient` sheen from white 10
    percent to alpha 0 on top, onPrimary text in headline variant, `numberOfLines`
    2. Disabled: surfaceVariant background, textSecondary text. Wrapped in
    `PressableScale`.
17. `LanguageToggleButton`. Keep no props. Contained pill on surfaceVariant,
    height 36, horizontal padding 12, translate icon 18, short label from
    `lang.toggleShort`. Wrapped in `PressableScale`.

`ScreenContainer` keeps its current role (flex background plus bottom safe area)
and renders `<Atmosphere />` first and children after. No blobs.

## 8. Screen specifications

Common rules for all five screens:

- `<ScreenContainer>` is the root. The first child in scroll content is the
  screen title in `display` variant.
- The native header stays minimal: back button and `headerRight` actions only.
  Set `headerTitle: ''` through `navigation.setOptions` so the in-content title is
  the only title. Do not enable `headerLargeTitle`.
- Every sheet is a `BottomSheet` rendered as the last element of the screen tree,
  after the FAB. This matters for Android blur and touch order.
- Each screen keeps exactly one active sheet, typed as a union such as
  `'none' | 'sort' | 'menu' | 'create' | 'rename'`, instead of one boolean per
  sheet. Opening a sheet replaces the open one. This prevents stacked scrims and
  duplicate Android back handlers.
- The in-tree sheet scrim does not cover the native header, so header actions
  stay tappable while a sheet is open. That is fine with the single-sheet rule:
  tapping another header action swaps the sheet instead of stacking one.
- All list entrance animations use the stagger helper. Every tappable uses
  `PressableScale` or one of the primitives that already wraps it.
- The editor and sheets use `getFontFamily` for `TextInput` fonts.
- Long-press menus use `ActionSheet`. Delete confirmations keep the existing
  `Alert.alert` behavior.

### 8.1 FoldersScreen (home)

- Header right: `LanguageToggleButton` and a menu `IconButton` (dots-vertical or
  menu icon). The menu opens an ActionSheet style list in a `BottomSheet` with
  rows: Storage usage (navigates), Cloud sync, Tags and filters, Backup and
  restore. The three coming-soon rows keep the current Alert behavior. Reuse the
  existing `drawer.*` translation keys. Delete the orange drawer and its RN
  `Modal` entirely.
- Folder grid: 2 columns, gap 12. `FolderCard` is a `PressableScale` with the
  accent tint, radius lg, and a top sheen `LinearGradient` from white 12 percent
  to alpha 0. Folder icon 24 in ink at top-left, folder name headline in text
  color below it, note count caption in ink at 80 percent opacity. No border.
- Sort and reorder: a sort `IconButton` in the header opens a `BottomSheet` with
  the sheet title `sort.title`, field Chips (custom, name, createdAt) using
  `sort.custom`, `sort.name`, `sort.createdAt`, a direction toggle using
  `sort.asc` and `sort.desc`, and a reorder mode toggle with the existing
  `sort.reorder` and `sort.reorderHint` text. All existing state and logic move
  unchanged.
- Reorder arrows: up/down `IconButton`s rendered on the card only in reorder
  mode. Keep the existing move behavior.
- Long-press a folder card opens an ActionSheet: Rename (`action.rename`) and
  Delete (`common.delete`, destructive). Delete keeps the current Alert
  confirmation and error handling.
- Create and rename: `BottomSheet` with title (`folder.newTitle` or
  `folder.renameTitle`), `TextInput` in surfaceVariant with radius md and padding
  14, and a footer row with a text Cancel button (`common.cancel`) and a
  `PrimaryButton` (`folder.create` or `common.save`, showing the existing creating
  and renaming strings while busy). On error keep the existing Alert behavior.
- FAB: folder-plus icon, opens the create sheet.

### 8.2 NotesListScreen

- Title: the folder name in display variant. Header right: sort `IconButton` (same
  sheet pattern as folders, with existing `sort.*` strings) and
  `LanguageToggleButton`.
- Structure the body as one vertical `FlatList`: the title and `SearchBar` go in
  `ListHeaderComponent`, the note cards are the items, and `EmptyState` goes in
  `ListEmptyComponent`. That keeps the search bar visible while showing an empty
  search result, which the current separate-TextInput layout cannot do.
- `SearchBar` sits directly under the title as part of the scroll content. On
  Android it renders as a solid surfaceVariant pill, on iOS as glass. Placeholder
  `notes.searchPlaceholder`.
- Note cards: single column, `surface` background, radius lg, padding 16, entrance
  stagger. Title headline, two-line preview bodySmall textSecondary, meta row:
  relative date caption, microphone icon 18 plus audioCount when audioCount > 0,
  paperclip plus fileCount when fileCount > 0. Meta icons textSecondary.
- The mic glyph is always static. There is no global playback state in this app
  and playback unloads when the editor unmounts, so the list must not try to show
  what is playing. Do not add playback state here; that would be a new feature.
- Relative date uses `formatMetaDate(updatedAt, language, t)` from
  `src/utils/dateFormat.ts`: `date.today` when the same calendar day,
  `date.yesterday` for one day before, otherwise
  `Intl.DateTimeFormat(language === 'bn' ? 'bn-BD' : 'en-US', { day: 'numeric',
  month: 'short' })` with a `d/m` fallback if `Intl` throws.
- Long-press opens an ActionSheet with Delete (`common.delete`, destructive).
  Remove the always-visible trash icon and the mic column on the right.
- Reorder mode: same as folders, arrows as `IconButton`s only in reorder mode,
  and the existing `sort.reorderSearchHint` behavior when searching.
- FAB: plus icon, new note.

### 8.3 NoteEditorScreen

The largest screen. Preserve every piece of logic. Only presentation changes. Work
in small commits and keep the file compiling.

- Header: back button, `headerTitle: ''`, header right keeps the current save state
  or overflow control.
- Title `TextInput`: borderless, transparent, editor title type (28/700),
  placeholder textSecondary, font from `getFontFamily(language, '700')`. Content
  `TextInput`: borderless, 17/400 line height 26, `getFontFamily(language, '400')`,
  flex grows. No boxed inputs.
- Attachments render between the content and the bottom bar.
  - Audio group card: surface background, radius lg. Play/pause `IconButton` in a
    primary tonal container, group name headline, duration caption,
    `AnimatedBars` while this group plays, progress track 3 px in surfaceVariant
    with a primary fill animated to the current position. Overflow `IconButton`
    opens an ActionSheet containing the existing actions, all with existing
    translation keys: append (`editor.audioAdd`, `editor.appendStop`), rename
    (`action.rename`), details (`editor.audioDetails`), share
    (`editor.shareAudio`), delete (`common.delete`, destructive).
  - File attachment row: surfaceVariant, radius md, file-type icon, name
    bodySmall, overflow `IconButton` with the existing share and remove actions.
- Bottom action bar: `GlassSurface` with radius pill or xl, positioned exactly
  like today's bar: absolutely with `bottom: Math.max(insets.bottom, 10)`,
  rendered after the `ScrollView` in tree order so Android blur can capture the
  page. Keep the current keyboard behavior (Android `adjustResize`); do not add a
  `KeyboardAvoidingView` here. Contained buttons: plus (square `IconButton`), mic
  (circular, primary fill while recording), attach-file (circular), overflow
  (pill). Recording state replaces the row with: red pulsing dot inside
  `AnimatedRing` drawing on start, timer text in caption, pause and stop
  `IconButton`s. Keep the existing pulse and equalizer animated values.
- Rename and details modals become `BottomSheets`, reusing `editor.renameTitle`,
  `editor.renamePlaceholder`, `editor.renameSave`, `editor.audioDetails`,
  `editor.audioLocationTitle`, `editor.audioLocationClose`. The share-audio picker
  stays a sheet with `editor.shareAudioPickerTitle`. The file viewer keeps its
  current presentation, restyled to tokens.

### 8.4 ShareImportScreen

- Title in display variant, file rows as `Card`s with type icon, name, size, folder
  picker rows as `Card`s, `PrimaryButton` pill at the bottom for import. Keep the
  import logic exactly as it is, including the success `Alert` and the navigation
  that follows it. Do not add a checkmark draw here: the Alert already reports
  success and delaying navigation to show an animation would change behavior.
  Replace the two hardcoded English count strings in the body ("N audio file(s)"
  and "N image/PDF file(s)") with `shareImport.audioCount` and
  `shareImport.fileCount` from section 12.

### 8.5 StorageUsageScreen

- Title in display variant. Total used shown as `AnimatedRing` with the display
  variant number in the center and a caption unit below. Breakdown rows: icon in a
  tonal circle (use `FOLDER_ACCENTS[index % 8]` tints), label bodySmall,
  formatted bytes caption, thin progress track in surfaceVariant with a primary
  fill animated proportionally. Refresh stays a header `IconButton` using
  `storage.refresh` and `storage.refreshing`.

## 9. Dependencies and assets

Run exactly this, then rebuild the native app:

```sh
npx expo install expo-linear-gradient expo-blur react-native-svg expo-device
npm run android
```

Notes:

- `expo install` picks the versions that match SDK 54. Do not hand-pin.
- These are native modules. The checked-in `android/` and `ios/` projects
  autolink them on the next `npm run android` or `npm run ios`; no prebuild
  needed. If the build fails with unresolved native modules, run
  `npx expo prebuild --clean` only as a last resort and expect a diff in the
  native folders.
- Web is not a target for testing these changes.

Font, verified on 2026-09-10:

```sh
curl -L -o assets/fonts/NotoSansBengali-SemiBold.ttf \
  https://raw.githubusercontent.com/notofonts/notofonts.github.io/main/fonts/NotoSansBengali/hinted/ttf/NotoSansBengali-SemiBold.ttf
```

Fallback URL if the first 404s:

```
https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/NotoSansBengali/NotoSansBengali-SemiBold.ttf
```

After download, confirm the file is larger than 100 KB and starts with the sfnt
signature (`file assets/fonts/NotoSansBengali-SemiBold.ttf` should say TrueType).
Register in `App.tsx`:

```ts
await Font.loadAsync({
  'NotoSansBengali': require('./assets/fonts/NotoSansBengali-Regular.ttf'),
  'NotoSansBengali-SemiBold': require('./assets/fonts/NotoSansBengali-SemiBold.ttf'),
});
```

Glass risk note: Android blur uses `experimentalBlurMethod="dimezisBlurView"`,
which is experimental in SDK 54. On Android 12+ (API 31) it uses RenderNode and is
acceptable. Below API 31 the quality module disables it. If scrolling janks even
with blur enabled, drop the editor bar to `blurOn="ios"` first, then lower
`intensity`. Never blur repeated list cards.

## 10. Execution order

Each phase ends with `npx tsc --noEmit` passing and the app building and launching
with no red screen. Use the compile-apk skill when an installable APK is needed.

1. Dependencies and font. Run the install command, rebuild, confirm the app
   launches. Download the SemiBold TTF, verify it, and register both fonts.
   Temporarily render a `LinearGradient` and a `BlurView` in the loading screen to
   prove the native modules work, then remove.
2. Tokens. Rewrite `colors.ts` and `ui.ts` per section 4. Add `FOLDER_ACCENTS` and
   the package internal `AppTheme` rename. Update `App.tsx` navigation theme and
   the 30 `colors.card`, 7 `colors.accent`, and 6 `colors.secondary` usages per
   the migration table. `npx tsc --noEmit` must pass.
3. Quality module and fonts plumbing. Add `src/theme/quality.ts` per section 13.2,
   mount `QualityProvider` in `App.tsx`, add `AppText` and `getFontFamily`, fix the
   header title font, and sweep every `<Text>` to `AppText`. Visual output is
   roughly unchanged after this phase.
4. Primitives. Build `Atmosphere`, `GlassSurface`, `PressableScale`, `Card`,
   `SearchBar`, `FAB`, `IconButton`, `Chip`, `BottomSheet`, `ActionSheet`,
   `AnimatedRing`, `AnimatedBars`, `EmptyArt`. Restyle `EmptyState`,
   `PrimaryButton`, `LanguageToggleButton`, and `ScreenContainer`. Verify in a
   scratch screen that sheets open, glass renders, and press springs work before
   touching product screens.
5. FoldersScreen rebuild per 8.1: remove the orange drawer, convert the create,
   rename, and menu modals to sheets, and collapse the sheet booleans into one
   active-sheet union state.
6. NotesListScreen rebuild per 8.2, including `formatMetaDate`.
7. NoteEditorScreen restyle per 8.3, in small steps, keeping the file compiling.
8. ShareImportScreen and StorageUsageScreen per 8.4 and 8.5.
9. Polish. Entrance staggers, FAB pops, ring and art draws, dark mode on all five
   screens, ink contrast check for all 8 accents, both languages checked for
   truncation (Bengali runs longer), press states everywhere, delete leftover
   numeric `ui.font` keys, and set `QUALITY_OVERRIDE` to `'reduced'` once to verify
   the fallback tier, then back to `'auto'`.

## 11. Acceptance criteria

- Atmosphere renders on all five screens as one coherent gradient system. No
  random decorative circles, no blobs.
- No 1px bordered cards. Borders only as hairlines or on glass edges.
- Glass appears only on sheets, the notes search bar, and the editor bottom bar.
  Every glass surface has a readable solid fallback. Android below API 31 shows
  no blur and still looks intentional.
- Search bar is solid on Android by design (pitfall 2), glass on iOS.
- No `fontFamily: 'NotoSansBengali'` literal outside `AppText.tsx`,
  `getFontFamily`, and the `Font.loadAsync` plus `headerTitleStyle` wiring in
  `App.tsx`.
- English UI renders in the system font, Bengali in NotoSansBengali with two
  weights.
- All modals are bottom sheets. No centered dialog cards. No RN `Modal` remains
  except, if any, the file viewer untouched by this pass.
- Sort controls live in a sheet behind a header icon.
- List item actions are behind long-press ActionSheets.
- Every tappable springs on press. Lists stagger in on mount. FAB pops in.
- Empty states draw their illustration on mount. The storage ring animates to the
  real value. Playing audio in the editor shows animated bars. The recording ring
  draws on start.
- At most one sheet is open per screen, and Android back closes it.
- `useReducedMotion()` disables drift, entrance, and draws.
- `QUALITY_OVERRIDE = 'reduced'` produces a fully static, solid-fill build with no
  layout breakage.
- Exactly four new dependencies: expo-linear-gradient, expo-blur,
  react-native-svg, expo-device.
- All existing behaviors verified manually: create/rename/delete folder, sort and
  reorder folders, create/edit/delete note, search notes, record/pause/stop/
  append/play audio, attach and view files, share import flow, storage screen
  numbers, language toggle on every screen.
- Light and dark themes both pass a visual check on all five screens.

## 12. i18n additions

Add these keys to both language objects in `src/i18n/translations.ts` in the same
edit. Everything else reuses existing keys, in particular all `drawer.*`, `sort.*`,
`folder.*`, `editor.*`, and `common.*` keys.

| key | bn | en |
|---|---|---|
| date.today | আজ | Today |
| date.yesterday | গতকাল | Yesterday |
| action.rename | নাম পরিবর্তন | Rename |
| sort.title | সাজানোর নিয়ম | Sort by |
| shareImport.audioCount | {count}টি অডিও ফাইল | {count} audio file(s) |
| shareImport.fileCount | {count}টি ছবি/PDF ফাইল | {count} image/PDF file(s) |

Never hardcode a user-facing string.

## 13. Reference implementations

These snippets are normative. Keep them small and typed. No `any`.

### 13.1 Theme types

```ts
// colors.ts shapes
export type ThemeColors = { /* exact fields in 4.1 */ };
export type FolderAccent = { light: string; inkLight: string; dark: string; inkDark: string };
export const FOLDER_ACCENTS: FolderAccent[] = [ /* 4.2 */ ];
export const AppTheme: { light: ThemeColors; dark: ThemeColors } = { /* 4.1 */ };
export const getThemeColors = (isDark: boolean) => (isDark ? AppTheme.dark : AppTheme.light);
```

```ts
// ui.ts
import type { TextStyle } from 'react-native';

export type TypeVariant = 'display' | 'title' | 'headline' | 'body' | 'bodySmall' | 'caption';
export type TypeToken = {
  size: number;
  weight: TextStyle['fontWeight'];
  lineHeight: number;
};

export const ui: {
  radius: { sm: number; md: number; lg: number; xl: number; sheet: number; fab: number; pill: number };
  space: { xs: number; sm: number; md: number; lg: number; xl: number; xxl: number; xxxl: number };
  type: Record<TypeVariant, TypeToken>;
  font: { xs: number; sm: number; md: number; lg: number; xl: number };
} = {
  radius: { sm: 8, md: 12, lg: 16, xl: 24, sheet: 28, fab: 18, pill: 999 },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 },
  type: {
    display: { size: 32, weight: '700', lineHeight: 38 },
    title: { size: 22, weight: '700', lineHeight: 28 },
    headline: { size: 17, weight: '600', lineHeight: 22 },
    body: { size: 16, weight: '400', lineHeight: 24 },
    bodySmall: { size: 14, weight: '400', lineHeight: 20 },
    caption: { size: 12, weight: '500', lineHeight: 16 },
  },
  font: { xs: 12, sm: 13, md: 14, lg: 16, xl: 18 },
};
```

### 13.2 Quality module

```ts
// src/theme/quality.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { PropsWithChildren } from 'react';
import { Platform } from 'react-native';
import {
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
} from 'react-native-reanimated';

export type Quality = {
  blurEnabled: boolean;
  ambientDrift: boolean;
  motionEnabled: boolean;
};

type Override = 'auto' | 'full' | 'reduced';

// Flip to 'reduced' or 'full' to test tiers manually.
export const QUALITY_OVERRIDE: Override = 'auto';

const PROBE_KEY = 'ui.quality.probe.v1';

const isIOS = Platform.OS === 'ios';
const apiLevel = isIOS
  ? Number.MAX_SAFE_INTEGER
  : Number(Device.platformApiLevel ?? Platform.Version);
const yearClass = Device.deviceYearClass ?? Number.MAX_SAFE_INTEGER;
const totalMemory = Device.totalMemory ?? Number.MAX_SAFE_INTEGER;

const blurSupported = isIOS || apiLevel >= 31;
const specsHandleDrift = isIOS || yearClass >= 2019 || totalMemory >= 6 * 1024 ** 3;

const QualityContext = createContext<Quality>({
  blurEnabled: blurSupported,
  ambientDrift: specsHandleDrift,
  motionEnabled: true,
});

const useQualityProbe = (enabled: boolean, onDone: (reduced: boolean) => void) => {
  const slowFrames = useSharedValue(0);
  const totalFrames = useSharedValue(0);

  const frame = useFrameCallback((info) => {
    totalFrames.value += 1;
    if ((info.timeSincePreviousFrame ?? 0) > 32) {
      slowFrames.value += 1;
    }
  }, false);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let stopTimer: ReturnType<typeof setTimeout> | undefined;
    const startTimer = setTimeout(() => {
      frame.setActive(true);
      stopTimer = setTimeout(() => {
        frame.setActive(false);
        const sampled = totalFrames.value;
        const slowRatio = sampled > 0 ? slowFrames.value / sampled : 0;
        const reduced = sampled >= 120 && slowRatio > 0.15;
        AsyncStorage.setItem(PROBE_KEY, reduced ? 'reduced' : 'full').catch(() => {});
        onDone(reduced);
      }, 6000);
    }, 3000);

    return () => {
      clearTimeout(startTimer);
      if (stopTimer) {
        clearTimeout(stopTimer);
      }
      frame.setActive(false);
    };
  }, [enabled, frame, onDone, slowFrames, totalFrames]);
};

type ProbeResult = 'unknown' | 'full' | 'reduced';

export const QualityProvider = ({ children }: PropsWithChildren) => {
  const reduceMotion = useReducedMotion();
  const [probeResult, setProbeResult] = useState<ProbeResult>('unknown');

  useEffect(() => {
    AsyncStorage.getItem(PROBE_KEY)
      .then((value) => {
        if (value === 'reduced' || value === 'full') {
          setProbeResult(value);
        }
      })
      .catch(() => {});
  }, []);

  const handleProbeDone = useCallback((reduced: boolean) => {
    setProbeResult(reduced ? 'reduced' : 'full');
  }, []);

  const probeEnabled =
    probeResult === 'unknown' &&
    !__DEV__ &&
    Device.isDevice &&
    QUALITY_OVERRIDE === 'auto' &&
    specsHandleDrift;

  useQualityProbe(probeEnabled, handleProbeDone);

  const value = useMemo<Quality>(() => {
    const downgraded =
      QUALITY_OVERRIDE === 'reduced' ||
      (QUALITY_OVERRIDE === 'auto' && probeResult === 'reduced');
    return {
      blurEnabled: QUALITY_OVERRIDE === 'reduced' ? false : blurSupported,
      ambientDrift: specsHandleDrift && !downgraded && !reduceMotion,
      motionEnabled: QUALITY_OVERRIDE === 'reduced' ? false : !reduceMotion,
    };
  }, [probeResult, reduceMotion]);

  return <QualityContext.Provider value={value}>{children}</QualityContext.Provider>;
};

export const useQuality = () => useContext(QualityContext);
```

### 13.3 AppText

```tsx
// src/components/AppText.tsx
import { Text } from 'react-native';
import type { TextProps } from 'react-native';
import { useLanguage } from '../i18n/LanguageContext';
import type { Language } from '../i18n/translations';
import { useAppColors } from '../theme/useAppColors';
import { ui, type TypeToken, type TypeVariant } from '../theme/ui';

type AppTextProps = TextProps & {
  variant?: TypeVariant;
  color?: string;
};

export const getFontFamily = (language: Language, weight: TypeToken['weight']) =>
  language === 'bn'
    ? weight === '400'
      ? 'NotoSansBengali'
      : 'NotoSansBengali-SemiBold'
    : undefined;

export const AppText = ({ variant = 'body', color, style, ...rest }: AppTextProps) => {
  const { language } = useLanguage();
  const { colors } = useAppColors();
  const token = ui.type[variant];
  const isBengali = language === 'bn';

  return (
    <Text
      {...rest}
      style={[
        {
          fontFamily: getFontFamily(language, token.weight),
          fontWeight: isBengali ? undefined : token.weight,
          fontSize: token.size,
          lineHeight: token.lineHeight,
          color: color ?? colors.text,
        },
        style,
      ]}
    />
  );
};
```

### 13.4 PressableScale

```tsx
// src/components/PressableScale.tsx
import { Pressable } from 'react-native';
import type { PressableProps, StyleProp, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const PRESS_SPRING = { damping: 15, stiffness: 260 };

type PressableScaleProps = Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>;
};

export const PressableScale = ({ style, onPressIn, onPressOut, ...rest }: PressableScaleProps) => {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(event) => {
        scale.value = withSpring(0.97, PRESS_SPRING);
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        scale.value = withSpring(1, PRESS_SPRING);
        onPressOut?.(event);
      }}
      style={[style, animatedStyle]}
    />
  );
};
```

### 13.5 GlassSurface

```tsx
// src/components/GlassSurface.tsx
import { BlurView } from 'expo-blur';
import type { PropsWithChildren } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { useAppColors } from '../theme/useAppColors';
import { useQuality } from '../theme/quality';

type GlassSurfaceProps = PropsWithChildren<{
  radius: number;
  blurOn?: 'all' | 'ios';
  intensity?: number;
  fallbackColor?: string;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
}>;

export const GlassSurface = ({
  radius,
  blurOn = 'all',
  intensity,
  fallbackColor,
  style,
  contentStyle,
  children,
}: GlassSurfaceProps) => {
  const { isDark, colors } = useAppColors();
  const { blurEnabled } = useQuality();
  const blurActive = blurEnabled && (blurOn === 'all' || Platform.OS === 'ios');

  return (
    <View
      style={[
        {
          borderRadius: radius,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.glassBorder,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {blurActive ? (
        <BlurView
          intensity={intensity ?? (isDark ? 35 : 45)}
          tint={isDark ? 'dark' : 'light'}
          experimentalBlurMethod="dimezisBlurView"
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      <View
        style={[
          { backgroundColor: blurActive ? colors.glass : fallbackColor ?? colors.surface },
          contentStyle,
        ]}
      >
        {children}
      </View>
    </View>
  );
};
```

### 13.6 Atmosphere

```tsx
// src/components/Atmosphere.tsx
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useAppColors } from '../theme/useAppColors';
import { useQuality } from '../theme/quality';

type GlowProps = {
  color: string;
  size: number;
  opacity: number;
  driftMs: number;
  style: { top?: number; bottom?: number; left?: number; right?: number };
  animate: boolean;
};

const Glow = ({ color, size, opacity, driftMs, style, animate }: GlowProps) => {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = animate
      ? withRepeat(
          withTiming(1, { duration: driftMs, easing: Easing.inOut(Easing.quad) }),
          -1,
          true
        )
      : 0;
  }, [animate, driftMs, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: progress.value * 10 - 5 },
      { translateY: progress.value * 10 - 5 },
      { scale: 1 + progress.value * 0.06 },
    ],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size / 2,
          opacity,
          overflow: 'hidden',
        },
        style,
        animatedStyle,
      ]}
    >
      <LinearGradient
        colors={[color, `${color}00`]}
        start={{ x: 0.2, y: 0.1 }}
        end={{ x: 0.9, y: 0.9 }}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
};

export const Atmosphere = () => {
  const { colors } = useAppColors();
  const { ambientDrift } = useQuality();
  const { width } = useWindowDimensions();
  const size = Math.round(width * 0.9);
  const [a, b, c] = colors.atmosphere;
  const opacity = colors.atmosphereOpacity;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient
        colors={[colors.background, colors.backgroundDeep]}
        style={StyleSheet.absoluteFill}
      />
      <Glow
        color={a}
        size={size}
        opacity={opacity}
        driftMs={18000}
        style={{ top: -width * 0.35, left: -width * 0.25 }}
        animate={ambientDrift}
      />
      <Glow
        color={b}
        size={size}
        opacity={opacity}
        driftMs={24000}
        style={{ top: -width * 0.15, right: -width * 0.35 }}
        animate={ambientDrift}
      />
      <Glow
        color={c}
        size={size}
        opacity={opacity}
        driftMs={30000}
        style={{ bottom: -width * 0.4, left: width * 0.05 }}
        animate={ambientDrift}
      />
    </View>
  );
};
```

### 13.7 BottomSheet

```tsx
// src/components/BottomSheet.tsx
import type { PropsWithChildren } from 'react';
import { useEffect, useState } from 'react';
import {
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useIsFocused } from '@react-navigation/native';
import { AppText } from './AppText';
import { GlassSurface } from './GlassSurface';
import { useAppColors } from '../theme/useAppColors';
import { useQuality } from '../theme/quality';
import { ui } from '../theme/ui';

type BottomSheetProps = PropsWithChildren<{
  visible: boolean;
  onClose: () => void;
  title?: string;
}>;

export const BottomSheet = ({ visible, onClose, title, children }: BottomSheetProps) => {
  const { colors } = useAppColors();
  const { motionEnabled } = useQuality();
  const isFocused = useIsFocused();
  const { height } = useWindowDimensions();
  const progress = useSharedValue(0);
  const [mounted, setMounted] = useState(visible);
  const travel = Math.min(height * 0.8, 640);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value * 0.4 }));
  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * travel }],
  }));

  useEffect(() => {
    if (visible) {
      setMounted(true);
      progress.value = motionEnabled
        ? withSpring(1, { damping: 18, stiffness: 220 })
        : withTiming(1, { duration: 150 });
    } else {
      progress.value = withTiming(0, { duration: motionEnabled ? 200 : 0 }, (finished) => {
        if (finished) {
          runOnJS(setMounted)(false);
        }
      });
    }
  }, [motionEnabled, progress, visible]);

  useEffect(() => {
    if (!visible || !isFocused) {
      return;
    }
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [isFocused, onClose, visible]);

  if (!mounted) {
    return null;
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }, scrimStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        pointerEvents="box-none"
        style={{ flex: 1, justifyContent: 'flex-end' }}
      >
        <Animated.View style={panelStyle}>
          <GlassSurface
            radius={ui.radius.sheet}
            contentStyle={{ paddingBottom: ui.space.xl }}
            style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}
          >
            <View style={{ alignItems: 'center', paddingTop: ui.space.sm }}>
              <View
                style={{
                  width: 36,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: colors.textSecondary,
                  opacity: 0.4,
                }}
              />
            </View>
            {title ? (
              <AppText
                variant="title"
                style={{ paddingHorizontal: ui.space.lg, paddingTop: ui.space.md }}
              >
                {title}
              </AppText>
            ) : null}
            <View style={{ paddingTop: ui.space.md }}>{children}</View>
          </GlassSurface>
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
};
```

### 13.8 AnimatedRing

```tsx
// src/components/AnimatedRing.tsx
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Circle, Svg } from 'react-native-svg';
import { useQuality } from '../theme/quality';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

type AnimatedRingProps = {
  progress: number;
  size: number;
  strokeWidth: number;
  color: string;
  trackColor: string;
  children?: ReactNode;
};

export const AnimatedRing = ({
  progress,
  size,
  strokeWidth,
  color,
  trackColor,
  children,
}: AnimatedRingProps) => {
  const { motionEnabled } = useQuality();
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const value = useSharedValue(0);

  useEffect(() => {
    const target = Math.min(Math.max(progress, 0), 1);
    value.value = motionEnabled
      ? withTiming(target, { duration: 900, easing: Easing.out(Easing.cubic) })
      : target;
  }, [motionEnabled, progress, value]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - value.value),
  }));

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={trackColor}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          animatedProps={animatedProps}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={StyleSheet.absoluteFillObject}>{children}</View>
    </View>
  );
};
```

### 13.9 App.tsx wiring

```tsx
// loading screen setup
await Font.loadAsync({
  'NotoSansBengali': require('./assets/fonts/NotoSansBengali-Regular.ttf'),
  'NotoSansBengali-SemiBold': require('./assets/fonts/NotoSansBengali-SemiBold.ttf'),
});

// provider order
<GestureHandlerRootView style={{ flex: 1 }}>
  <ShareIntentProvider>
    <LanguageProvider>
      <QualityProvider>
        <AppNavigator />
      </QualityProvider>
    </LanguageProvider>
  </ShareIntentProvider>
</GestureHandlerRootView>

// navigation theme inside AppNavigator
const { language } = useLanguage();
const navTheme = {
  ...baseTheme,
  colors: {
    ...baseTheme.colors,
    primary: colors.primary,
    background: colors.background,
    card: colors.surface,
    text: colors.text,
    border: colors.border,
    notification: colors.primaryBright,
  },
};

// navigator options
screenOptions={{
  headerStyle: { backgroundColor: colors.surface },
  headerTintColor: colors.primary,
  headerTitleStyle: {
    fontFamily: language === 'bn' ? 'NotoSansBengali-SemiBold' : undefined,
  },
  contentStyle: { backgroundColor: colors.background },
}}
```

### 13.10 Relative date helper

```ts
// src/utils/dateFormat.ts
import type { Language } from '../i18n/translations';

type Translate = (key: string) => string;

const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

export const formatMetaDate = (iso: string, language: Language, t: Translate) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const dayDiff = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86_400_000);
  if (dayDiff === 0) {
    return t('date.today');
  }
  if (dayDiff === 1) {
    return t('date.yesterday');
  }

  try {
    return new Intl.DateTimeFormat(language === 'bn' ? 'bn-BD' : 'en-US', {
      day: 'numeric',
      month: 'short',
    }).format(date);
  } catch {
    return `${date.getDate()}/${date.getMonth() + 1}`;
  }
};
```

### 13.11 AnimatedBars

```tsx
// src/components/AnimatedBars.tsx
import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useAppColors } from '../theme/useAppColors';
import { useQuality } from '../theme/quality';

const IDLE = [0.35, 0.6, 0.45, 0.75, 0.5, 0.4, 0.65];
const LOUD = [0.7, 1, 0.8, 1, 0.85, 0.6, 0.9];
const BAR_HEIGHT = 20;

type BarProps = {
  index: number;
  active: boolean;
  color: string;
};

const Bar = ({ index, active, color }: BarProps) => {
  const scale = useSharedValue(IDLE[index]);

  useEffect(() => {
    if (!active) {
      scale.value = withTiming(IDLE[index], { duration: 200 });
      return;
    }
    scale.value = withDelay(
      index * 40,
      withRepeat(
        withSequence(
          withTiming(LOUD[index], { duration: 300, easing: Easing.inOut(Easing.quad) }),
          withTiming(IDLE[index], { duration: 300, easing: Easing.inOut(Easing.quad) })
        ),
        -1,
        false
      )
    );
    return () => cancelAnimation(scale);
  }, [active, index, scale]);

  const style = useAnimatedStyle(() => ({ transform: [{ scaleY: scale.value }] }));

  return (
    <Animated.View
      style={[{ width: 4, height: BAR_HEIGHT, borderRadius: 2, backgroundColor: color }, style]}
    />
  );
};

type AnimatedBarsProps = { playing: boolean; color?: string };

export const AnimatedBars = ({ playing, color }: AnimatedBarsProps) => {
  const { colors } = useAppColors();
  const { motionEnabled } = useQuality();
  const active = playing && motionEnabled;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
      {IDLE.map((_, index) => (
        <Bar key={index} index={index} active={active} color={color ?? colors.primary} />
      ))}
    </View>
  );
};
```

### 13.12 EmptyArt

```tsx
// src/components/EmptyArt.tsx
import { useEffect } from 'react';
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { Path, Svg } from 'react-native-svg';
import { useAppColors } from '../theme/useAppColors';
import { useQuality } from '../theme/quality';

const AnimatedPath = Animated.createAnimatedComponent(Path);

export type EmptyArtName = 'folders' | 'notes' | 'search' | 'generic';

const PATHS: Record<EmptyArtName, string[]> = {
  folders: [
    'M22 44 h24 l8 10 h44 a8 8 0 0 1 8 8 v34 a8 8 0 0 1 -8 8 h-76 a8 8 0 0 1 -8 -8 v-44 a8 8 0 0 1 8 -8 z',
    'M36 76 h48',
    'M36 88 h34',
  ],
  notes: [
    'M40 20 h40 a6 6 0 0 1 6 6 v68 a6 6 0 0 1 -6 6 h-40 a6 6 0 0 1 -6 -6 v-68 a6 6 0 0 1 6 -6 z',
    'M48 44 h32',
    'M48 58 h32',
    'M48 72 h20',
  ],
  search: [
    'M56 34 a22 22 0 1 1 0 44 a22 22 0 1 1 0 -44',
    'M72 72 l18 18',
  ],
  generic: [
    'M34 46 h52 a8 8 0 0 1 8 8 v40 a8 8 0 0 1 -8 8 h-52 a8 8 0 0 1 -8 -8 v-40 a8 8 0 0 1 8 -8 z',
    'M42 68 h36',
    'M42 82 h24',
  ],
};

// The dash length only has to exceed the real path length (all paths live in a
// 120 box), so no runtime measurement is needed.
const DASH = 400;

type DrawPathProps = {
  d: string;
  delay: number;
  color: string;
};

const DrawPath = ({ d, delay, color }: DrawPathProps) => {
  const { motionEnabled } = useQuality();
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = motionEnabled
      ? withDelay(delay, withTiming(1, { duration: 800, easing: Easing.out(Easing.cubic) }))
      : 1;
  }, [delay, motionEnabled, progress]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: DASH * (1 - progress.value),
  }));

  return (
    <AnimatedPath
      d={d}
      stroke={color}
      strokeWidth={4}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
      strokeDasharray={`${DASH} ${DASH}`}
      animatedProps={animatedProps}
    />
  );
};

type EmptyArtProps = { name: EmptyArtName; size?: number };

export const EmptyArt = ({ name, size = 56 }: EmptyArtProps) => {
  const { colors } = useAppColors();
  const { motionEnabled } = useQuality();
  const float = useSharedValue(0);

  useEffect(() => {
    float.value = motionEnabled
      ? withRepeat(
          withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.quad) }),
          -1,
          true
        )
      : 0;
  }, [motionEnabled, float]);

  const floatStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: float.value * -4 }],
  }));

  return (
    <Animated.View style={[{ width: size, height: size }, floatStyle]}>
      <Svg width={size} height={size} viewBox="0 0 120 120">
        {PATHS[name].map((d, index) => (
          <DrawPath key={d} d={d} delay={index * 90} color={colors.textSecondary} />
        ))}
      </Svg>
    </Animated.View>
  );
};
```

## 14. Pitfalls checklist

Read this before phase 4. Each item is a real failure mode, not theory.

1. Do not build `BottomSheet` on RN `Modal`. On Android a Modal is a separate
   window, and `BlurView` inside it captures the modal window, not the screen
   behind, so glass would never blur. The in-tree absolute overlay in 13.7 fixes
   this and standardizes iOS and Android on one code path.
2. `BlurView` has a known issue: blur does not update when it renders before
   dynamic content such as a FlatList. The editor bar is rendered after the scroll
   view, so it is safe. The search bar cannot guarantee order inside a list header,
   so it is solid on Android by design (`blurOn="ios"`).
3. Android `BlurView` ignores `borderRadius` set directly. The parent must have
   `overflow: 'hidden'`. `GlassSurface` already does this.
4. Custom Bengali fonts plus `fontWeight` on Android produces synthetic bold or
   silently falls back to the system font. `AppText` sets `fontWeight` only for
   English and picks the family for Bengali.
5. `Platform.Version` is the API level number on Android and a version string on
   iOS. iOS is handled separately in the quality module.
6. Reading a shared value with `.value` from the JS thread is fine for the one-shot
   probe. Do not do it per frame or in render.
7. Reanimated entering animations run on mount. Keep FlatList keys stable
   (existing `keyExtractor` by id) so items are not remounted on every render.
8. Never animate `height`, `width`, or layout props. Animate `transform` and
   `opacity` only. Progress bars animate `scaleX` or a percentage width only once
   on mount via `withTiming`.
9. SVG prop animations need `Animated.createAnimatedComponent` plus
   `useAnimatedProps`. If your reanimated patch version fails to animate
   `strokeDashoffset`, the ring still renders the correct final state; fall back to
   a horizontal progress bar and keep moving.
10. `Intl` can be missing in trimmed JS engines. `formatMetaDate` catches and falls
    back to `d/m`.
11. `TextInput` does not use `AppText`. Use `getFontFamily` for every input.
12. `'transparent'` in `LinearGradient` can interpolate through gray. Use the same
    hex with `00` alpha, as in 13.6.
13. Sheets include text inputs (create, rename). Keep `KeyboardAvoidingView` and
    test with the keyboard open on both platforms.
14. The editor bottom bar must respect the bottom safe area and the keyboard. Use
    the current keyboard handling logic, only restyle the bar.
15. Delete confirmations stay `Alert.alert`. Do not convert them to sheets.
16. When Android blur is on but the blurred view has nothing drawn behind it yet
    (cold start, empty list), the blur may look black. The translucent fill on top
    hides it; do not stack glass on glass.
17. Reorder arrows and the overflow buttons live inside a card that is itself
    pressable and long-pressable. Call `event.stopPropagation()` in their
    `onPress`, as the current code already does, or tapping an arrow also opens
    the note or folder and fires the long-press ActionSheet.
18. The bottom sheet overlay is inside the screen, so the native header is not
    covered by the scrim. Keep one sheet state per screen (section 8 common) so a
    header tap swaps the sheet instead of stacking a second scrim.
19. The editor bar already works with the keyboard through Android
    `adjustResize` and an absolute bottom inset. Restyle it in place; do not wrap
    the editor in `KeyboardAvoidingView` and do not move it into the `ScrollView`.
