# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [Semantic Versioning](https://semver.org/).

## Unreleased

### Added

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
