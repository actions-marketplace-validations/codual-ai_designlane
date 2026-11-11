/** A tokens.json as Designmap writes it, with just the tokens a test needs. */

interface ColorToken {
  key: string;
  hex: string;
  /** False for a colour the code writes without a name. */
  named?: boolean;
  dark?: string;
}

interface StyleToken {
  key: string;
  size?: number;
  weight?: number;
}

export function tokensJson({
  colors = [],
  spacing = [],
  radii = [],
  partial = false,
  app,
  styles = [],
}: {
  colors?: ColorToken[];
  spacing?: number[];
  radii?: number[];
  /** The scan couldn't read the whole app. */
  partial?: boolean;
  /** The app's name, as the scan records it. */
  app?: string;
  styles?: StyleToken[];
}) {
  const colorValue = (hex: string) => ({ colorSpace: "srgb", components: [0, 0, 0], hex });
  return JSON.stringify({
    $description: "test",
    ...((partial || app) && {
      $extensions: { designmap: { ...(app && { app }), ...(partial && { partial: true }) } },
    }),
    ...(colors.length > 0 && {
      color: Object.fromEntries(
        colors.map((color) => [
          color.key,
          {
            $type: "color",
            $value: colorValue(color.hex),
            $extensions: {
              designmap: {
                ...(color.named !== false && { reference: `Theme.${color.key}` }),
                source: "Theme.swift",
                uses: 1,
                ...(color.dark && { modes: { dark: colorValue(color.dark) } }),
              },
            },
          },
        ]),
      ),
    }),
    ...(spacing.length > 0 && {
      spacing: Object.fromEntries(
        spacing.map((value) => [`space-${value}`, { $type: "dimension", $value: { value, unit: "px" } }]),
      ),
    }),
    ...(radii.length > 0 && {
      radius: Object.fromEntries(
        radii.map((value) => [`radius-${value}`, { $type: "dimension", $value: { value, unit: "px" } }]),
      ),
    }),
    ...(styles.length > 0 && {
      typography: Object.fromEntries(
        styles.map((style) => [
          style.key,
          {
            $extensions: { designmap: { name: style.key, reference: `Font.${style.key}`, uses: 1 } },
            fontFamily: { $type: "fontFamily", $value: "SF Pro" },
            ...(style.size !== undefined && {
              fontSize: { $type: "dimension", $value: { value: style.size, unit: "px" } },
            }),
            ...(style.weight !== undefined && { fontWeight: { $type: "fontWeight", $value: style.weight } }),
          },
        ]),
      ),
    }),
  });
}
