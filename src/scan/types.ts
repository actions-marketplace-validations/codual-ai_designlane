export type FrameworkId = "swiftui";

export type Platform = "ios";

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
  uses: number;
}

export interface DesignTokens {
  /** Most used first. */
  colors: ColorToken[];
  /** Colours left out of `colors` to keep it short. */
  colorsOmitted: number;
  /** Most used first. */
  systemColors: SystemColor[];
  /** Most used first. */
  typeStyles: TypeStyle[];
  /** Text styles left out of `typeStyles` to keep it short. */
  typeStylesOmitted: number;
  /** Custom font families: those used, most used first, then those written only in the app's own helpers. */
  fonts: string[];
  /** Most common first. */
  spacing: number[];
  /** Most common first. */
  radii: number[];
}

export interface FrameworkScan {
  framework: FrameworkId;
  platforms: Platform[];
  screens: ScreenRef[];
  tokens: DesignTokens;
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
