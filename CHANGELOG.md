# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [Semantic Versioning](https://semver.org/).

## Unreleased

### Changed

- A repo with both an iPhone and an Android app gets a tokens file for each, `tokens.ios.json` and
  `tokens.android.json`, instead of being refused. A tokens file Designmap wrote in the other layout is removed, and
  the CLI says so.
- Library: `toDesignTokens(scan, framework)` takes the framework to write when a scan has two, and throws for one the
  scan doesn't have; `writeOutputs` returns `tokens` as a list and the files it `removed`. `APP_TOKENS_FILES` and
  `TOKENS_FILE` name the files.
