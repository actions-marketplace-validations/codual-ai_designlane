# Designmap

Keep your design tools in sync with your app's code.

https://github.com/user-attachments/assets/29a82c2f-6df5-4788-a596-fab2a4b10efb

## How it works

1. **Read from the code.** Designmap reads your app's colours, type styles, spacing and corner radii, with how the
   code refers to each one. The colours and text styles the code names (`Theme.surface`, a typography style) go to
   `designmap/tokens.json`, the design system a sync keeps; values written in place in a screen's layout, and the
   spacing and radii, are listed in `DESIGN.md`, so editing a screen doesn't change the design system. A GitHub
   Action keeps both current on every push.
2. **See what changed.** The Designmap plugin for Figma reads `tokens.json` from your repo and shows the plan: what's
   new, what changed, and what the code no longer uses. Nothing changes until you press Apply.
3. **Apply.** Your Figma variables and text styles update in place, and a page in the file shows the design system
   as swatches and type samples. Names a designer changed are kept, and nothing is deleted.

Designmap reads SwiftUI and Jetpack Compose apps today. For Compose it reads the design tokens: the Material colour
scheme (each role with its Light and Dark value), the type scale and named text styles, an app's own colour class,
colour resources, and the spacing and corner radii written in `dp`.

For both, it finds the app's screens and how they open each other (pushed, a sheet, a dialog, full screen, a popover, a
tab, a pane beside, or starting over) and the screen the app starts on: in SwiftUI through navigation links,
presentation modifiers, tabs, split views and an app's own router; in Compose through Navigation Compose, Navigation 3
and Circuit. It doesn't yet read Compose tab switches, or spacing the code names (`Dimens.medium`).

React Native support has started with colours: those an app's theme objects name (a `light` and a `dark` theme paired
into one colour, a theme's colours reached through another's), Tailwind's (a `tailwind.config.js`, or a CSS
`@theme`, as NativeWind and Uniwind use), and colours written straight into styles. It reads text styles too: those
a typography object names, and those written in place in style sheets and `style` props (a font file's name like
`Inter-SemiBold` read as its family and weight, a size scaled to the phone's settings read at the size written), with
Tailwind's text classes; and the spacing and corner radii styles and Tailwind classes set. It finds the app's
screens: those its navigators show (React Navigation's `<Stack.Screen>`, its static `screens` config and an app's own
stack creators), Expo Router's route files, a modal's whole content, and components that look like whole pages
(lists, scrolling, safe areas); links between them come later. A React Native app's SwiftUI or Compose code (a widget, an extension) is left out, as its native
side.

A repo with both an iPhone and an Android app gets a design system for each, since the two often differ (a
different blue, the platform's own fonts): `designmap/tokens.ios.json` and `designmap/tokens.android.json`, with one
DESIGN.md covering both. Connect each Figma file to its app's path.

### A design system in its own repo

Some teams keep their theme in a separate library that the app imports. Designmap then tells you the theme is
defined outside the app. Add Designmap to the library's repo instead, and connect the Figma plugin there: that repo
is where the colours and text styles are written.

## Status

Designmap is in early development and not released yet.

## License

[Apache 2.0](LICENSE)
