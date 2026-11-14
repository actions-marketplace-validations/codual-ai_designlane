/** Values read from an app's code made safe to write into CSS: only what a colour or a font name can be. */

const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
/** Characters a font family's name is made of; anything else could end the value and start another. */
const NOT_IN_FONT_NAME = /[^\w .-]/g;

export const isHexColor = (value: string) => HEX_COLOR.test(value);

/** A font family as a quoted CSS name, with the platform's own font after it. */
export const cssFontFamily = (family: string) =>
  `"${family.replace(NOT_IN_FONT_NAME, "")}", -apple-system, system-ui, sans-serif`;
