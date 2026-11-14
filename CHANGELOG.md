# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [Semantic Versioning](https://semver.org/).

## Unreleased

### Added

- Apps with several themes: each theme beside the default one is read with its own colours, Light and Dark, and
  written under `theme` in tokens.json, keyed by its name (old files without it read as before). The Figma plugin
  makes a collection for each, "IceCubes · Desert (Designmap)", matching, renaming and deprecating a theme's
  variables only within it, and DESIGN.md lists each theme's colours. SwiftUI: types conforming to one protocol of
  colours, paired light and dark by name or a `scheme` member (types with neither stay plain colours), each
  colour known by the protocol's member (`ColorSet.tintColor`); the first theme declared is the default. React
  Native: the themes beside a light and dark one that were left out before (`themes.black`, presets, a
  `darkContrastTheme` in its own file). The CLI names them.
- SwiftUI colours declared with `.init(hex:)` (`let ink: Color = .init(hex: 0x112233)`).
- Android text styles kept in XML resources (`TextAppearance.*` styles and those inheriting one, followed up to
  Material's own), with their size, family and weight.
- React Native font sizes an app names on its own (`variables.fontSizeLarge`, `FONT_SIZE_SMALL`), as text styles
  holding a size.

- React Native colours of a theme chosen by platform (`Platform.OS === "ios" ? blackIOS : blackAndroid`,
  `Platform.select`, in the file or imported) read as iOS's, as a design shows them.

### Removed

- The scan's `otherThemes` and the note naming them: those themes are read now.

### Changed

- A sync follows a theme the code renamed (`MainTheme.colors.error` becoming `BoltTheme.colors.error`) with its
  values unchanged: each variable and text style keeps its name and everything using it, however many changed.

- tokens.json holds only the colours and text styles the code names, the design system a sync keeps. Colours and
  text styles written in place, and spacing and corner radii, are listed in DESIGN.md only, so editing a screen's
  layout no longer shows up as design-system changes in Figma. A Figma file synced before this sees those
  spacing, radius, unnamed colour and in-place text style variables marked deprecated on its next sync.

### Added

- React Native screens: components React Navigation's screens show (`component`, `getComponent`, a children
  function, static `screens`, an app's own stack creators, through requires and imports), Expo Router's route files
  (layouts as containers), a modal's whole content, and the shared classifier's signs (lists, scrolling, safe areas).

- React Native text styles, spacing and corner radii: named typography objects with how often the code reaches
  them, styles written in place (spread named styles included), constants and default exports followed, font file
  names read as family and weight, and Tailwind's text, spacing and rounded classes at its sizes or a config's.

- React Native colours: theme objects (light and dark paired, aliases followed, one light and one dark theme kept of
  several), Tailwind configs and CSS `@theme` colours with the class names using them, and colours written into
  styles. Their tokens name each colour as the code does, in Figma's web code slot. A React Native app's native code
  isn't read as an app of its own.

### Changed

- A repo with both an iPhone and an Android app gets a tokens file for each, `tokens.ios.json` and
  `tokens.android.json`, instead of being refused. A tokens file Designmap wrote in the other layout is removed, and
  the CLI says so.
- Library: `toDesignTokens(scan, framework)` takes the framework to write when a scan has two, and throws for one the
  scan doesn't have; `writeOutputs` returns `tokens` as a list and the files it `removed`. `APP_TOKENS_FILES` and
  `TOKENS_FILE` name the files.
