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
  name: string;
  /** `#rrggbb` or `#rrggbbaa`. */
  light: string;
  dark?: string;
  /** The file it was found in. */
  source: string;
}

export interface DesignTokens {
  colors: ColorToken[];
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
