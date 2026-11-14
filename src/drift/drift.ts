/** Where an app's UI code skips its own design system: colours written as values, spacing and corner radii off the
 * scale the code uses, text styles written in place that match a named one, and near-duplicate components. */

import { type ComponentInfo, readerOf } from "../catalog/components.js";
import { lineIndex } from "../catalog/reader.js";
import { type AppSources, type CodeFile, codeFiles, type FrameworkSources } from "../catalog/sources.js";
import { blankRanges } from "../frameworks/source-text.js";
import { isNamedStyle, keyedColors, keyedStyles } from "../output/token-names.js";
import { byCode } from "../scan/counting.js";
import type { FrameworkId, FrameworkScan, ScanResult } from "../scan/types.js";
import { type DuplicatePair, duplicates } from "./duplicates.js";
import { COLOR_LITERALS, SCALE_LITERALS, type ScaleKind } from "./literals.js";

export interface Location {
  file: string;
  line: number;
}

/** A token by the key tokens.json gives it and how the code refers to it. */
export interface TokenName {
  key: string;
  reference?: string;
}

export interface ColorDrift {
  framework: FrameworkId;
  /** `#rrggbb[aa]`. */
  value: string;
  /** A named colour with this value, light or dark, the code could use instead. */
  token?: TokenName;
  uses: Location[];
}

/** A spacing or corner value used rarely, right beside one the code uses often: likely meant to be that one. */
export interface ScaleDrift {
  framework: FrameworkId;
  kind: ScaleKind;
  value: number;
  nearest: number;
  /** How often the code uses `nearest`. */
  nearestUses: number;
  uses: Location[];
}

/** A text style written in place with the same font, size and weight as one the code names. */
export interface TypeDrift {
  framework: FrameworkId;
  name: string;
  uses: number;
  token: TokenName;
}

export interface DriftReport {
  colors: ColorDrift[];
  scale: ScaleDrift[];
  typeStyles: TypeDrift[];
  duplicates: DuplicatePair[];
}

/** Where colours and sizes are meant to be written as values: theme, token and design-system folders and files,
 * by whole name (`theme/`, `colors.ts`, `Color+Brand.swift`), so `ThemeToggle` or `colorful.ts` is still UI code. */
const THEME_PATH =
  /(?:^|\/)(?:themes?|tokens?|design-?system|colou?rs?|palette|styles?)(?:\/|(?:\+\w+)?\.)|tailwind\.config/i;
/** A file named for the design system in whole words, one other word at most before them: `AppColors.kt`,
 * `ThemeTokens.swift`, `Type.kt`; not `TypeBadge.swift`, `ColorfulCard.swift` or `CardType.swift`. */
const THEME_FILE =
  /(?:^|\/)(?:(?:[A-Z][a-z]+)?(?:Colou?rs?|Themes?|Palette|Typography|Dimens|Spacing|Tokens?)+|Type)(?:\+\w+)?\.(?:kt|swift|[cm]?[jt]sx?)$/;
/** Build and tooling configs aren't UI. */
const CONFIG = /(?:^|\/)(?:app|metro|babel|jest|webpack|vite|eslint|tailwind)\.config\.[cm]?[jt]s$/;
/** A value used at least `onScaleUses` times is on the scale the code uses; one used at most `rareUses` times, within
 * `maxDistance` of one on it, is likely off it, unless it's on the `grid`, which is deliberate however rare. */
export const SCALE_RULES = { onScaleUses: 3, rareUses: 2, maxDistance: 2, grid: 4 } as const;
/** Larger values are layout sizes, not spacing or corners. */
const MAX_SCALE_VALUE = 64;

interface UiFile extends CodeFile {
  lineAt: (offset: number) => number;
}

const isThemeFile = (rel: string) => THEME_PATH.test(rel) || THEME_FILE.test(rel);

/** The UI files of a framework, with their previews blanked along with comments and strings. */
function uiFiles(f: FrameworkScan, sources: FrameworkSources | undefined): UiFile[] {
  if (!sources) return [];
  const defined = new Set(f.tokens.colors.filter((c) => c.kind !== "inline").map((c) => c.source));
  const reader = readerOf(sources);
  return codeFiles(sources)
    .filter((file) => !defined.has(file.rel) && !isThemeFile(file.rel) && !CONFIG.test(file.rel))
    .map((file) => ({
      ...file,
      code: blankRanges(file.code, reader.previews(file.rel)),
      lineAt: lineIndex(file.text),
    }));
}

/** Every match of `pattern` that starts in code, not in a comment, string or preview, with its location. */
function* located(file: UiFile, pattern: RegExp) {
  for (const m of file.text.matchAll(pattern)) {
    const at = m.index ?? 0;
    if (file.code[at] !== " ") yield { m, at: { file: file.rel, line: file.lineAt(at) } };
  }
}

function colorDrift(f: FrameworkScan, files: UiFile[]): ColorDrift[] {
  const tokens = keyedColors(f.tokens.colors);
  const byValue = new Map<string, ColorDrift>();
  for (const file of files) {
    for (const { pattern, hex } of COLOR_LITERALS[f.framework])
      for (const { m, at } of located(file, pattern)) {
        const value = hex(m);
        if (!value) continue;
        let entry = byValue.get(value);
        if (!entry) {
          const match = tokens.find(
            ({ color }) => color.reference && (color.light === value || color.dark === value),
          );
          const token = match && {
            key: match.key,
            ...(match.color.reference ? { reference: match.color.reference } : {}),
          };
          entry = { framework: f.framework, value, ...(token ? { token } : {}), uses: [] };
          byValue.set(value, entry);
        }
        entry.uses.push(at);
      }
  }
  // Those matching a token first: each is a one-line fix.
  return [...byValue.values()].sort(
    (a, b) =>
      Number(!!b.token) - Number(!!a.token) || b.uses.length - a.uses.length || byCode(a.value, b.value),
  );
}

function scaleDrift(f: FrameworkScan, files: UiFile[]): ScaleDrift[] {
  const out: ScaleDrift[] = [];
  for (const { kind, pattern } of SCALE_LITERALS[f.framework]) {
    const uses = new Map<number, Location[]>();
    for (const file of files)
      for (const { m, at } of located(file, pattern)) {
        const value = Number(m[1]);
        if (!Number.isFinite(value) || value <= 0 || value > MAX_SCALE_VALUE) continue;
        const list = uses.get(value);
        if (list) list.push(at);
        else uses.set(value, [at]);
      }
    const scale = [...uses].filter(([, at]) => at.length >= SCALE_RULES.onScaleUses).map(([value]) => value);
    for (const [value, at] of uses) {
      if (at.length > SCALE_RULES.rareUses || value % SCALE_RULES.grid === 0) continue;
      const nearest = nearestOf(value, scale);
      if (nearest === undefined || Math.abs(nearest - value) > SCALE_RULES.maxDistance) continue;
      out.push({
        framework: f.framework,
        kind,
        value,
        nearest,
        nearestUses: uses.get(nearest)?.length ?? 0,
        uses: at,
      });
    }
  }
  return out.sort((a, b) => byCode(a.kind, b.kind) || a.value - b.value);
}

/** The closest of `scale` to `value`, the smaller on a tie; none when the scale is empty. */
function nearestOf(value: number, scale: number[]): number | undefined {
  const distance = (option: number) => Math.abs(option - value);
  return [...scale].sort((a, b) => distance(a) - distance(b) || a - b)[0];
}

function typeDrift(f: FrameworkScan): TypeDrift[] {
  const styles = keyedStyles(f.tokens.typeStyles, f.platforms[0]);
  const named = styles.filter(({ style }) => isNamedStyle(style));
  const same = (a: (typeof styles)[number], b: (typeof styles)[number]) =>
    a.values.fontFamily === b.values.fontFamily &&
    a.values.fontSize !== undefined &&
    a.values.fontSize === b.values.fontSize &&
    a.values.fontWeight === b.values.fontWeight;
  return styles.flatMap((written) => {
    if (isNamedStyle(written.style)) return [];
    const match = named.find((n) => same(n, written));
    if (!match) return [];
    const token = { key: match.key, ...(match.style.reference ? { reference: match.style.reference } : {}) };
    return [{ framework: f.framework, name: written.style.name, uses: written.style.uses, token }];
  });
}

/** Where the code drifts from its own design system. The same code always gives the same report. */
export function findDrift(scan: ScanResult, sources: AppSources, components: ComponentInfo[]): DriftReport {
  const report: DriftReport = { colors: [], scale: [], typeStyles: [], duplicates: duplicates(components) };
  for (const f of scan.frameworks) {
    const files = uiFiles(f, sources.get(f.framework));
    report.colors.push(...colorDrift(f, files));
    report.scale.push(...scaleDrift(f, files));
    report.typeStyles.push(...typeDrift(f));
  }
  return report;
}
