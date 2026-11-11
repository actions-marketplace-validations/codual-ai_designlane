# Designmap

Keep your Figma design system in sync with your app's code.

https://github.com/user-attachments/assets/382e854a-1545-44d9-b94b-70c56336c43c

## How it works

1. **Read from the code.** Designmap reads your app's colours, type styles, spacing and corner radii, with how the
   code refers to each one, and writes them to `designmap/tokens.json`. A GitHub Action keeps that file current on
   every push.
2. **See what changed.** The Designmap plugin for Figma reads `tokens.json` from your repo and shows the plan: what's
   new, what changed, and what the code no longer uses. Nothing changes until you press Apply.
3. **Apply.** Your Figma variables and text styles update in place, and a page in the file shows the design system
   as swatches, type samples and scales. Names a designer changed are kept, and nothing is deleted.

Designmap reads SwiftUI apps today.

## Status

Designmap is in early development and not released yet.

## License

[Apache 2.0](LICENSE)
