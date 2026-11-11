import { themesOutside } from "./compose-external-theme.js";
import { composeTokens } from "./compose-tokens.js";
import { kotlinSources } from "./kotlin-sources.js";
import type { FrameworkPlugin } from "./plugin.js";

/** Jetpack Compose (and Compose Multiplatform): its design tokens. Its screens come in a later piece. */
export const compose: FrameworkPlugin = {
  id: "compose",
  platforms: ["android"],
  screensRead: false,
  async scan(ctx) {
    const sources = await kotlinSources(ctx);
    if (!sources.some((s) => s.compose)) return undefined;
    return { views: [], tokens: await composeTokens(ctx, sources), themesOutside: themesOutside(sources) };
  },
};
