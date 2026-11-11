# Designmap

Keep your design tools in sync with your app's code.

https://github.com/user-attachments/assets/29a82c2f-6df5-4788-a596-fab2a4b10efb

## How it works

1. **Read from the code.** Designmap reads your app's colours, type styles, spacing and corner radii, with how the
   code refers to each one, and writes them to `designmap/tokens.json`. A GitHub Action keeps that file current on
   every push.
2. **See what changed.** The Designmap plugin for Figma reads `tokens.json` from your repo and shows the plan: what's
   new, what changed, and what the code no longer uses. Nothing changes until you press Apply.
3. **Apply.** Your Figma variables and text styles update in place, and a page in the file shows the design system
   as swatches, type samples and scales. Names a designer changed are kept, and nothing is deleted.

Designmap reads SwiftUI and Jetpack Compose apps today. For Compose it reads the design tokens: the Material colour
scheme (each role with its Light and Dark value), the type scale and named text styles, an app's own colour class,
colour resources, and the spacing and corner radii written in `dp`. It doesn't read Compose screens yet, or spacing
the code names (`Dimens.medium`). A repo with both an iOS and an Android app is synced one app at a time: run
Designmap on each app's folder.

### A design system in its own repo

Some teams keep their theme in a separate library that the app imports. Designmap then tells you the theme is
defined outside the app. Add Designmap to the library's repo instead, and connect the Figma plugin there: that repo
is where the colours and text styles are written.

## Status

Designmap is in early development and not released yet.

## License

[Apache 2.0](LICENSE)
