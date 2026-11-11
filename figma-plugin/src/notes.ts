/** The notes a sync leaves for the designer: what it left out of the file, and why. */

/** The note for something a sync left out, and why. */
export const leftOut = (name: string, reason: string) => `${name} was left out: ${reason}.`;

/** The note for a text style left out because this file doesn't have `font`. */
export const missingFont = (name: string, font: string) => leftOut(name, `this file doesn't have ${font}`);
