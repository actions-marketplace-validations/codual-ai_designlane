import { describe, expect, it } from "vitest";
import { classify, type ViewFacts } from "../../src/scan/classify.js";

const facts = (overrides: Partial<ViewFacts>): ViewFacts => ({
  name: "Home",
  file: "App/Home.swift",
  line: 1,
  pageElements: 0,
  bodyLines: 10,
  presented: false,
  routed: false,
  childFiles: 0,
  holdsViews: false,
  ...overrides,
});

const kind = (overrides: Partial<ViewFacts>) => classify("swiftui", [facts(overrides)])[0]?.kind;

describe("classify", () => {
  it("builds ids from the framework, file and name", () => {
    expect(classify("swiftui", [facts({})])[0]).toMatchObject({ id: "swiftui:App/Home.swift#Home", line: 1 });
  });

  it.each<[string, Partial<ViewFacts>]>([
    ["opened as a page", { presented: true }],
    ["named like a screen", { name: "HomeScreen" }],
    ["full of page elements", { pageElements: 5 }],
    ["routed with some page code", { routed: true, pageElements: 1 }],
    [
      "in a screens folder with page code and a long body",
      { file: "Screens/Home.swift", pageElements: 1, bodyLines: 80 },
    ],
  ])("treats a view %s as a screen", (_, overrides) => expect(kind(overrides)).toBe("screen"));

  it.each<[string, Partial<ViewFacts>]>([
    ["with nothing page-like", {}],
    ["ending in a component word, even opened as a page", { name: "PlanRow", presented: true }],
    ["reused in many files, despite page code", { pageElements: 3, childFiles: 3 }],
    ["only routed", { routed: true }],
  ])("treats a view %s as a component", (_, overrides) => expect(kind(overrides)).toBe("component"));

  it("leans a view placed inside another, and never opened, towards component", () => {
    expect(kind({ pageElements: 3 })).toBe("screen");
    expect(kind({ pageElements: 3, childFiles: 1 })).toBe("component");
  });

  it("weighs reuse in several files more than a single embedding", () => {
    expect(classify("swiftui", [facts({ pageElements: 3, childFiles: 1 })])[0]?.score).toBe(1);
    expect(classify("swiftui", [facts({ pageElements: 3, childFiles: 3 })])[0]?.score).toBe(0);
  });

  it("keeps a container a component whatever it scores", () => {
    const strong = { presented: true, pageElements: 3, name: "FeatureScreen", file: "features/F.swift" };
    expect(kind({ ...strong, holdsViews: true })).toBe("component");
    expect(classify("swiftui", [facts({ ...strong, holdsViews: true })])[0]?.score).toBe(2);
    expect(kind(strong)).toBe("screen");
  });

  it("lets being opened as a page outweigh reuse", () => {
    expect(kind({ presented: true, childFiles: 10 })).toBe("screen");
  });
});
