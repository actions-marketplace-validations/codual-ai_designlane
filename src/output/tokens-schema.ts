/** The shape of the tokens.json Designmap writes: one schema the writer's output is typed by and a sync reads with. */

import { z } from "zod";
import { PLATFORMS } from "../scan/types.js";

const Dimension = z.object({ value: z.number(), unit: z.literal("px") });

export const ColorValue = z.object({
  colorSpace: z.literal("srgb"),
  components: z.tuple([z.number(), z.number(), z.number()]),
  alpha: z.number().min(0).max(1).optional(),
  hex: z.string().regex(/^#[0-9a-f]{6}$/i),
});

/** Where a token comes from in the code, for a tool syncing it elsewhere: how the code refers to it, and its uses. */
const Origin = z.object({ reference: z.string().optional(), uses: z.number() });

/** A colour always says which file it comes from, which is part of a file-local constant's identity, and the line,
 * which orders same-named ones in a file. DTCG has no modes yet, so a dark value rides here. */
const ColorOrigin = Origin.extend({
  source: z.string(),
  line: z.number().int().min(1).optional(),
  modes: z.object({ dark: ColorValue }).optional(),
});

export const ColorTokenEntry = z.object({
  $type: z.literal("color"),
  $value: ColorValue,
  $description: z.string().optional(),
  $extensions: z.object({ designmap: ColorOrigin.strict() }),
});

const DimensionToken = z.object({ $type: z.literal("dimension"), $value: Dimension });
const FontFamilyToken = z.object({ $type: z.literal("fontFamily"), $value: z.string() });

/** A text style as the values the code sets, at least one of them, under the name the code gives it. */
export const TextStyleGroup = z
  .object({
    $description: z.string().optional(),
    $extensions: z.object({ designmap: Origin.extend({ name: z.string() }).strict() }),
    fontFamily: FontFamilyToken.optional(),
    fontSize: DimensionToken.optional(),
    fontWeight: z.object({ $type: z.literal("fontWeight"), $value: z.number() }).optional(),
  })
  .refine(
    (style) => Boolean(style.fontFamily || style.fontSize || style.fontWeight),
    "a text style sets no values",
  );

/** On the whole file: the app's name, and whether the scan couldn't read all of the app, so what's missing from it
 * may still be in the code. Files from before the app was named have no `app`. */
const FileExtensions = z.object({
  designmap: z.object({
    app: z.string().optional(),
    partial: z.literal(true).optional(),
    platform: z.enum(PLATFORMS).optional(),
  }),
});

/** A group: its `$description`, and tokens of one kind under every other key. */
const groupOf = <T extends z.ZodType>(token: T) =>
  z
    .record(z.string(), z.union([z.string(), token]))
    .refine(
      (group) =>
        Object.entries(group).every(([key, value]) => key.startsWith("$") === (typeof value === "string")),
      "only a group's $description is text; every other entry is a token",
    );

/** One app's tokens. Strict, so a file shaped otherwise (a group per framework) is refused rather than read as empty,
 * which would deprecate everything. */
export const TokensFile = z
  .object({
    $description: z.string(),
    $extensions: FileExtensions.optional(),
    color: groupOf(ColorTokenEntry).optional(),
    typography: groupOf(TextStyleGroup).optional(),
    fontFamily: groupOf(FontFamilyToken).optional(),
    spacing: groupOf(DimensionToken).optional(),
    radius: groupOf(DimensionToken).optional(),
  })
  .strict();

export type DesignTokensFile = z.input<typeof TokensFile>;
