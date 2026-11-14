# Designmap for Figma

Keeps a Figma file's variables and text styles in sync with an app's code.

1. Keep the app's `designmap/tokens.json` up to date with CI (below), or run `designmap ./YourApp` yourself.
2. Run `pnpm build:plugin`.
3. In Figma: **Plugins → Development → Import plugin from manifest…** and pick `figma-plugin/manifest.json`.
4. Run **Designmap** and connect the app's GitHub repo, with a fine-grained token that can only read this repo's
   contents. The token stays on your computer.
5. From then on, opening Designmap shows what changed in the code. Read the plan and press **Apply**.

You can also pick a `tokens.json` file instead of connecting a repo.

A repo with both an iPhone and an Android app gets a tokens file for each, `designmap/tokens.ios.json` and
`designmap/tokens.android.json`: connect each Figma file to its app's path.

## Keeping tokens.json up to date

Add this workflow to the app's repo as `.github/workflows/design-tokens.yml`. On every push to `main` it writes
`designmap/tokens.json` from the code, and commits it when it changed. A `main` protected from direct pushes refuses
that commit; allow GitHub Actions to push, or run the workflow on another branch.

```yaml
name: Design tokens
on:
  push:
    branches: [main]
permissions:
  contents: write
jobs:
  tokens:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: nikhil27gargeya/designmap-clean@main # pin to a release once there is one
        with:
          app: . # the app's folder, if it isn't the repo's root
```

## What a sync does

The plugin creates a variable collection named after the app, such as **Rummy (Designmap)**, and text styles. Each
one records the token's identity, so the next sync finds it under any name, and shows how the code refers to it
(`Theme.surface`) as a variable's iOS code syntax and in its description.

An app with several themes gets a collection for each theme beside its default one, such as **Rummy · Desert
(Designmap)**, with Light and Dark modes and the same variable names as the app's own collection, so you can see
every theme and design with any of them. Each theme is synced on its own, its changes named with it in the plan
(`Desert: color/tint`), and a theme the code drops has its variables deprecated. The design system page shows the
default theme.

It also draws the design system on a page of the same name: a swatch for each colour, linked to its variable, in
Light and, when it differs, Dark; and a sample of each text style, largest first. The
page is redrawn on every Apply. Only Designmap's own frame changes, where you last moved it, so anything you add to
the page outside that frame stays; anything added inside it is replaced.

On each sync:

- **New** tokens are created, named from the code.
- **Changed** values are updated in place. Renames a designer made are kept.
- Tokens **renamed in the code** keep their variable or text style when nothing else changed, and so does every
  token of a theme the code renamed.
- Tokens **no longer in the code** are marked deprecated, never deleted, since designs may still use them: variables
  are hidden from publishing, and text styles say so in their description (Figma can't hide a style). They come back
  if the code does.
- When the collection has no room for a Dark mode on your Figma plan, dark values are left out with a note, and each
  Apply tries to add the Dark mode again.
- Text styles whose font this file doesn't have are left out, and named in the plan.
- Variables and styles a designer made are left alone, and so are descriptions and publishing choices a designer set.
