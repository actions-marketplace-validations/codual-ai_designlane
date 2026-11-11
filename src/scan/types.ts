export type FrameworkId = "swiftui" | "compose";

/** The platforms an app's code can be for, as tokens.json records them. */
export const PLATFORMS = ["ios", "android"] as const;
export type Platform = (typeof PLATFORMS)[number];

/** Each framework as people write it. */
export const FRAMEWORK_NAMES: Record<FrameworkId, string> = {
  swiftui: "SwiftUI",
  compose: "Jetpack Compose",
};

/** `SwiftUI or Jetpack Compose`, for saying what an app without any of them is missing. */
export const SUPPORTED_FRAMEWORKS = Object.values(FRAMEWORK_NAMES).join(" or ");

export interface ScreenRef {
  /** `<framework>:<path>#<name>`, with `@<line>` added when a file declares the same name twice. */
  id: string;
  framework: FrameworkId;
  name: string;
  /** Relative to the project root, with forward slashes. */
  file: string;
  line: number;
  kind: "screen" | "component";
  /** How strongly the code looks like a whole screen; the scan lists the highest first. */
  score: number;
}

export interface ColorToken {
  /** The app's name for it, or its hex value when the code never names it. */
  name: string;
  /** `#rrggbb` or `#rrggbbaa`. */
  light: string;
  dark?: string;
  /** The file it was defined in, or first found in. */
  source: string;
  /** How the code refers to it (`Theme.surface`, `Color("Brand")`); missing for a value written without a name. */
  reference?: string;
  /** The line it's declared on, for a colour declared in code. */
  line?: number;
  /** An asset catalog entry, a named constant in code, or a value pasted into the code without a name. */
  kind: "asset" | "code" | "inline";
  /** How many places in the code use it, not counting its definition; pasted copies of its value count. */
  uses: number;
}

/** A platform colour the app uses (`.red`, `.systemBackground`), which adapts to the platform's own palette. */
export interface SystemColor {
  name: string;
  uses: number;
}

/** A text style the app uses, however it was written. */
export interface TypeStyle {
  /** A platform text style (`headline`), the app's own helper (`scaledBody`), or a description (`Inter 17 bold`). */
  name: string;
  kind: "text-style" | "system" | "custom" | "app";
  /** `System` for the platform font; empty when the family can't be read (a helper mixing several, or a constant). */
  family: string;
  /** In points; text styles at the default text size. Missing when the code computes it. */
  size?: number;
  weight: string;
  /** The app's own helper the code calls for it (`Font.brandTitle`); missing for a font written in place. */
  reference?: string;
  uses: number;
}

export interface DesignTokens {
  /** Every colour, most used first. */
  colors: ColorToken[];
  /** Most used first. */
  systemColors: SystemColor[];
  /** Every text style, most used first. */
  typeStyles: TypeStyle[];
  /** Custom font families: those used, most used first, then those written only in the app's own helpers. */
  fonts: string[];
  /** Every spacing value, most common first. */
  spacing: number[];
  /** Every corner radius, most common first. */
  radii: number[];
}

export interface FrameworkScan {
  framework: FrameworkId;
  platforms: Platform[];
  screens: ScreenRef[];
  tokens: DesignTokens;
  /** False when Designmap doesn't read this framework's screens yet. */
  screensRead?: false;
  /** Theme objects the code reads its design from that are defined outside the project (`ElementTheme`), so their
   * tokens are in the library's own code. */
  themesOutside?: string[];
}

export interface ScanResult {
  root: string;
  frameworks: FrameworkScan[];
  filesScanned: number;
  /** The project had more files than the scan reads. */
  truncated: boolean;
  /** Folders that couldn't be read. */
  unreadable: string[];
}
