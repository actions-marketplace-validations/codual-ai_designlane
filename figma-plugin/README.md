# Designmap for Figma

Keeps a Figma file's variables and text styles in sync with an app's code.

1. Run `designmap ./YourApp`. It writes `designmap/tokens.json`.
2. Run `pnpm build:plugin`.
3. In Figma: **Plugins → Development → Import plugin from manifest…** and pick `figma-plugin/manifest.json`.
4. Run **Designmap**, pick `tokens.json`, read the plan, and press **Apply**.

The plugin creates a **Designmap** variable collection and text styles. Each one records the token's identity, so the
next sync finds it under any name, and shows how the code refers to it (`Theme.surface`) as a variable's iOS code
syntax and in its description.

On each sync:

- **New** tokens are created, named from the code.
- **Changed** values are updated in place. Renames a designer made are kept.
- Tokens **renamed in the code** keep their variable or text style when nothing else changed.
- Tokens **no longer in the code** are marked deprecated, never deleted, since designs may still use them: variables
  are hidden from publishing, and text styles say so in their description (Figma can't hide a style). They come back
  if the code does.
- When the collection has no room for a Dark mode on your Figma plan, dark values are left out with a note, and each
  Apply tries to add the Dark mode again.
- Text styles whose font this file doesn't have are left out, and named in the plan.
- Variables and styles a designer made are left alone, and so are descriptions and publishing choices a designer set.

Run it again whenever `tokens.json` changes, for example after CI regenerates it.
