/** A small stand-in for the Figma plugin API: only what Designmap's plugin touches, with the limits and failures a
 * real file can have (a Figma plan's mode limit, a font that won't load). */

function sharedData() {
  const data = new Map<string, string>();
  return {
    getSharedPluginData: (namespace: string, key: string) => data.get(`${namespace}/${key}`) ?? "",
    setSharedPluginData: (namespace: string, key: string, value: string) =>
      void data.set(`${namespace}/${key}`, value),
  };
}

export interface FakeOptions {
  /** How many modes a collection may have, as on Figma's plans. */
  maxModes?: number;
  /** Font families installed in the file. */
  fonts?: Record<string, string[]>;
  /** Families whose fonts fail to load. */
  unloadable?: string[];
}

function fakeFigma({
  maxModes = 4,
  fonts = { Inter: ["Regular"], "SF Pro": ["Regular", "Medium", "Semibold", "Bold"] },
  unloadable = [],
}: FakeOptions = {}) {
  const installed = { ...fonts };
  let next = 1;
  const id = (prefix: string) => `${prefix}:${next++}`;
  const variables = new Map<string, ReturnType<typeof variable>>();
  const collections = new Map<string, ReturnType<typeof collection>>();
  const styles = new Map<string, ReturnType<typeof textStyle>>();

  function collection(name: string) {
    const defaultModeId = id("mode");
    const self = {
      id: id("collection"),
      name,
      defaultModeId,
      modes: [{ modeId: defaultModeId, name: "Mode 1" }],
      variableIds: [] as string[],
      ...sharedData(),
      renameMode(modeId: string, newName: string) {
        const mode = self.modes.find((mode) => mode.modeId === modeId);
        if (mode) mode.name = newName;
      },
      removeMode(modeId: string) {
        self.modes = self.modes.filter((mode) => mode.modeId !== modeId);
        if (self.defaultModeId === modeId) self.defaultModeId = self.modes[0]?.modeId ?? "";
      },
      addMode(newName: string) {
        if (self.modes.length >= maxModes) throw new Error(`Limited to ${maxModes} modes only`);
        const modeId = id("mode");
        self.modes.push({ modeId, name: newName });
        // Figma starts a new mode with each variable's value in the default mode.
        for (const variableId of self.variableIds) {
          const values = variables.get(variableId)?.valuesByMode;
          if (values) values[modeId] = values[self.defaultModeId];
        }
        return modeId;
      },
    };
    collections.set(self.id, self);
    return self;
  }

  function variable(name: string, owner: ReturnType<typeof collection>, resolvedType: "COLOR" | "FLOAT") {
    const self = {
      id: id("VariableID"),
      name,
      resolvedType,
      variableCollectionId: owner.id,
      valuesByMode: {} as Record<string, unknown>,
      scopes: [] as string[],
      description: "",
      hiddenFromPublishing: false,
      codeSyntax: {} as Record<string, string>,
      ...sharedData(),
      setValueForMode(modeId: string, value: unknown) {
        if (!owner.modes.some((mode) => mode.modeId === modeId)) throw new Error(`Invalid mode ${modeId}`);
        self.valuesByMode[modeId] = value;
      },
      removeVariableCodeSyntax(platform: string) {
        delete self.codeSyntax[platform];
      },
      setVariableCodeSyntax(platform: string, value: string) {
        self.codeSyntax[platform] = value;
      },
    };
    variables.set(self.id, self);
    owner.variableIds.push(self.id);
    return self;
  }

  /** Figma changes a style's font only with the new one loaded, and its size only with its font loaded. */
  const loaded = new Set<string>();
  const fontKey = ({ family, style }: { family: string; style: string }) => `${family}/${style}`;

  function textStyle() {
    let fontName = { family: "Inter", style: "Regular" };
    let fontSize = 12;
    const self = {
      id: id("S"),
      type: "TEXT" as const,
      name: "",
      description: "",
      /** How often the font was set, which in Figma resets a variable font's own axis settings. */
      fontSets: 0,
      get fontName() {
        return fontName;
      },
      set fontName(value) {
        if (!loaded.has(fontKey(value))) throw new Error(`${fontKey(value)} isn't loaded`);
        fontName = value;
        self.fontSets++;
      },
      get fontSize() {
        return fontSize;
      },
      set fontSize(value) {
        if (!loaded.has(fontKey(fontName))) throw new Error(`${fontKey(fontName)} isn't loaded`);
        fontSize = value;
      },
      ...sharedData(),
    };
    styles.set(self.id, self);
    return self;
  }

  const api = {
    variables: {
      getLocalVariableCollectionsAsync: async () => [...collections.values()],
      getVariableByIdAsync: async (key: string) => variables.get(key) ?? null,
      getVariableCollectionByIdAsync: async (key: string) => collections.get(key) ?? null,
      createVariableCollection: collection,
      createVariable: variable,
    },
    getLocalTextStylesAsync: async () => [...styles.values()],
    getStyleByIdAsync: async (key: string) => styles.get(key) ?? null,
    createTextStyle: textStyle,
    listAvailableFontsAsync: async () =>
      Object.entries(installed).flatMap(([family, names]) =>
        names.map((style) => ({ fontName: { family, style } })),
      ),
    closePlugin: () => {},
    loadFontAsync: async (font: { family: string; style: string }) => {
      if (unloadable.includes(font.family)) throw new Error(`could not load ${font.family}`);
      loaded.add(fontKey(font));
    },
  };
  /** Uninstalls a font family, as when a file opens on a machine without it. */
  const removeFamily = (family: string) => {
    delete installed[family];
  };
  return { api, variables, collections, styles, removeFamily };
}

/** Installs a fake as the `figma` global for the code under test, returning it to inspect. */
export function useFakeFigma(options?: FakeOptions) {
  const fake = fakeFigma(options);
  Object.assign(globalThis, { figma: fake.api });
  return fake;
}
