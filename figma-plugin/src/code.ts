/** The plugin's Figma side: shows its window and answers it through a session. */

import { createSession } from "./session.js";

figma.showUI(__html__, { width: 420, height: 560, themeColors: true });

const session = createSession((message) => figma.ui.postMessage(message));

figma.ui.onmessage = session;
