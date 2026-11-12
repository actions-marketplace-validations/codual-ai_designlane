import { describe, expect, it } from "vitest";
import { scanRepo } from "../../src/scan/index.js";
import { speedIt } from "../helpers/speed.js";
import { tempDir } from "../helpers/temp.js";

const view = (name: string, body = "Text(t)") => `struct ${name}: View { var body: some View { ${body} } }`;

async function kinds(files: Record<string, string>) {
  const withImports = Object.fromEntries(
    Object.entries(files).map(([rel, code]) => [rel, `import SwiftUI\n${code}`]),
  );
  const screens = (await scanRepo(await tempDir(withImports))).frameworks[0]?.screens ?? [];
  return Object.fromEntries(screens.map((s) => [s.name, s.kind]));
}

describe("pages the app opens", () => {
  it("doesn't treat a navigation link's label as a screen", async () => {
    const result = await kinds({
      "App/Root.swift": view("Root", "NavigationLink(destination: Detail()) {\n  Poster()\n}"),
      "App/Detail.swift": view("Detail"),
      "App/Poster.swift": view("Poster"),
    });
    expect(result).toMatchObject({ Detail: "screen", Poster: "component" });
  });

  it.each([
    [
      "a navigation link with a destination closure",
      "NavigationLink {\n  ProfileView()\n} label: {\n  Text(t)\n}",
    ],
    ["a full-screen cover", ".fullScreenCover(isPresented: $a) {\n  ProfileView()\n}"],
    ["a popover", ".popover(isPresented: $a) { ProfileView() }"],
    ["a navigation destination", ".navigationDestination(for: Int.self) { _ in ProfileView() }"],
    ["a window group", "WindowGroup { ProfileView() }"],
    [
      "a tab whose modifiers come before .tabItem",
      "TabView {\n  ProfileView()\n    .environmentObject(s)\n    .tabItem { Text(t) }\n}",
    ],
    ["a sheet inside an if", ".sheet(isPresented: $a) {\n  if ready {\n    ProfileView()\n  }\n}"],
    ["a generic call", ".sheet(isPresented: $a) { ProfileView<Int>() }"],
    ["an explicit init", ".sheet(isPresented: $a) { ProfileView.init() }"],
    [
      "a hosting root wrapped in a provider",
      "UIHostingController(rootView:\n  StoreProvider(store: s) {\n    ProfileView()\n  })",
    ],
    [
      "a widget configuration's content",
      "StaticConfiguration(kind: k, provider: P(), content: { entry in\n  ProfileView()\n})",
    ],
    ["an app-specific sheet helper", ".appSheet(item: $x) {\n  ProfileView()\n}"],
    [
      "a popover wrapped in a scroll view",
      ".popover(isPresented: $a) {\n  ScrollView {\n    ProfileView()\n  }\n}",
    ],
    [
      "a navigation link after a compiler directive",
      "#if os(iOS)\nNavigationLink {\n  ProfileView()\n} label: { Text(t) }\n#endif",
    ],
    ["a sheet's labelled content closure", ".sheet(item: $x, content: { item in\n  ProfileView()\n})"],
    ["an app-specific full-screen cover helper", ".customFullScreenCover(isPresented: $a) { ProfileView() }"],
    [
      "an intent widget configuration",
      "IntentConfiguration(kind: k, intent: I.self, provider: P()) { entry in ProfileView() }",
    ],
    ["a Live Activity configuration", "ActivityConfiguration(for: A.self) { context in ProfileView() }"],
    [
      "a sheet with a multi-line if",
      ".sheet(isPresented: $s) {\n  if let u = user,\n     u.ok {\n    ProfileView()\n  }\n}",
    ],
    ["a split view's detail column", "NavigationSplitView {\n  Text(t)\n} detail: {\n  ProfileView()\n}"],
    [
      "a three-column split view's detail column",
      "NavigationSplitView {\n  Text(t)\n} content: {\n  Text(t)\n} detail: {\n  ProfileView()\n}",
    ],
    ["a sheet", ".sheet(isPresented: $composing) {\n  ProfileView()\n}"],
    ["a navigation link destination", "NavigationLink(destination: ProfileView()) { Text(t) }"],
    ["a tab with .tabItem", "TabView {\n  ProfileView()\n    .tabItem { Label(t, systemImage: s) }\n}"],
    ["a Tab", 'Tab("Profile", systemImage: s) {\n  ProfileView()\n}'],
    ["a hosting controller root", "let controller = UIHostingController(rootView: ProfileView())"],
  ])("treats a plain view opened from %s as a screen", async (_, opener) => {
    const result = await kinds({
      "App/Root.swift": view("Root", opener),
      "App/ProfileView.swift": view("ProfileView"),
    });
    expect(result.ProfileView).toBe("screen");
  });

  it("doesn't count a view placed after a sheet's block has closed", async () => {
    const result = await kinds({
      "App/Root.swift": view("Root", ".sheet(isPresented: $a) {\n  Other()\n}\nStatusLine()"),
      "App/Other.swift": view("Other"),
      "App/StatusLine.swift": view("StatusLine"),
    });
    expect(result.StatusLine).toBe("component");
  });

  it("treats the parts of an inline sheet as components, however many lines down", async () => {
    const sheet = ".sheet(isPresented: $a) {\n  VStack {\n    EditorTop()\n\n\n\n    EditorBottom()\n  }\n}";
    const result = await kinds({
      "App/Root.swift": view("Root", sheet),
      "App/EditorTop.swift": view("EditorTop"),
      "App/EditorBottom.swift": view("EditorBottom"),
    });
    expect(result).toMatchObject({ EditorTop: "component", EditorBottom: "component" });
  });

  it("doesn't treat a navigation link's label argument as a screen", async () => {
    const result = await kinds({
      "App/Root.swift": view("Root", "NavigationLink(destination: Detail(), label: { Poster() })"),
      "App/Detail.swift": view("Detail"),
      "App/Poster.swift": view("Poster"),
    });
    expect(result).toMatchObject({ Detail: "screen", Poster: "component" });
  });

  it("treats every page a switch inside a sheet picks as presented", async () => {
    const sheet =
      ".sheet(item: $kind) { kind in\n  switch kind {\n  case .a: First()\n  case .b: Second()\n  }\n}";
    const result = await kinds({
      "App/Root.swift": view("Root", sheet),
      "App/First.swift": view("First"),
      "App/Second.swift": view("Second"),
    });
    expect(result).toMatchObject({ First: "screen", Second: "screen" });
  });

  it("doesn't treat an overlay helper named like a cover as a page", async () => {
    const result = await kinds({
      "App/Root.swift": view("Root", ".loadingCover(isLoading) {\n  Spinner()\n}"),
      "App/Spinner.swift": view("Spinner", "ScrollView { Text(t) }"),
    });
    expect(result.Spinner).toBe("component");
  });

  it("looks through an app wrapper between a sheet and the switch inside it", async () => {
    const sheet =
      ".sheet(item: $k) { k in\n  StoreProvider(store: s) {\n    switch k {\n    case .a: First()\n    case .b: Second()\n    }\n  }\n}";
    const result = await kinds({
      "App/Root.swift": view("Root", sheet),
      "App/First.swift": view("First"),
      "App/Second.swift": view("Second"),
    });
    expect(result).toMatchObject({ First: "screen", Second: "screen" });
  });

  it("treats the slides of a paged TabView carousel as components", async () => {
    const result = await kinds({
      "App/Root.swift": view(
        "Root",
        "TabView(selection: $page) {\n  Slide().tag(0)\n}\n.tabViewStyle(.page)",
      ),
      "App/Slide.swift": view("Slide", "ScrollView { Text(t) }"),
    });
    expect(result.Slide).toBe("component");
  });
});

describe("navigation routers", () => {
  it("counts a router case as a page only alongside page-like code", async () => {
    const router = view(
      "Root",
      "switch route {\n  case .profile:\n    ProfileView()\n  case .avatar:\n    AvatarPicker()\n}",
    );
    const result = await kinds({
      "App/Root.swift": router,
      "App/ProfileView.swift": view("ProfileView", "ScrollView { Text(t) }"),
      "App/AvatarPicker.swift": view("AvatarPicker"),
    });
    expect(result).toMatchObject({ ProfileView: "screen", AvatarPicker: "component" });
  });

  it("treats every view a router switch opens as a screen", async () => {
    const names = ["Home", "Search", "Inbox", "Account"];
    const cases = names
      .map((n) => `  case .${n.toLowerCase()}:\n    NavigationStack {\n      ${n}()\n    }`)
      .join("\n");
    const files: Record<string, string> = { "App/Router.swift": view("Router", `switch tab {\n${cases}\n}`) };
    for (const n of names) files[`App/${n}.swift`] = view(n);
    const result = await kinds(files);
    expect(names.map((n) => result[n])).toEqual(["screen", "screen", "screen", "screen"]);
  });

  it("doesn't treat a switch over loading states as a router", async () => {
    const states = ["Spinner", "Failure", "Empty", "Loaded"];
    const cases = states.map((n, i) => `  case .s${i}:\n    ${n}()`).join("\n");
    const files: Record<string, string> = { "App/Root.swift": view("Root", `switch state {\n${cases}\n}`) };
    for (const n of states) files[`App/${n}.swift`] = view(n);
    const result = await kinds(files);
    expect(states.map((n) => result[n])).toEqual(["component", "component", "component", "component"]);
  });

  it("pairs each case with its own switch when switches nest", async () => {
    const inner = "switch mode {\n    case .a: Compact()\n    case .b: Wide()\n    case .c: Tall()\n    }";
    const outer = `switch route {\n  case .home: Home()\n  case .other:\n    ${inner}\n  case .inbox: Inbox()\n  case .account: return AnyView(Account())\n}`;
    const files: Record<string, string> = { "App/Root.swift": view("Root", outer) };
    for (const n of ["Home", "Inbox", "Account", "Compact", "Wide", "Tall"])
      files[`App/${n}.swift`] = view(n);
    const result = await kinds(files);
    expect(result).toMatchObject({
      Home: "screen",
      Inbox: "screen",
      Account: "screen",
      Compact: "component",
    });
  });

  it("reads a router case that declares a variable before its page", async () => {
    const names = ["Home", "Search", "Inbox"];
    const cases = names.map(
      (n) =>
        `  case .${n.toLowerCase()}:\n    @Bindable var nav = navs\n    NavigationStack(path: $nav.path) {\n      ${n}()\n    }`,
    );
    const files: Record<string, string> = {
      "App/Router.swift": view("Router", `switch tab {\n${cases.join("\n")}\n}`),
    };
    for (const n of names) files[`App/${n}.swift`] = view(n);
    const result = await kinds(files);
    expect(names.map((n) => result[n])).toEqual(["screen", "screen", "screen"]);
  });
});

describe("parts, containers and helpers", () => {
  it("looks through the app's own container views", async () => {
    const names = ["Home", "Search", "Inbox", "Account"];
    const cases = names
      .map((n) => `  case .${n.toLowerCase()}:\n    NavigationTab {\n      ${n}()\n    }`)
      .join("\n");
    const files: Record<string, string> = {
      "App/Router.swift": view("Router", `switch tab {\n${cases}\n}`),
      "App/NavigationTab.swift":
        "struct NavigationTab<Content: View>: View { var body: some View { EmptyView() } }",
    };
    for (const n of names) files[`App/${n}.swift`] = view(n);
    const result = await kinds(files);
    expect(names.map((n) => result[n])).toEqual(["screen", "screen", "screen", "screen"]);
  });

  it("treats a view used inside many other files as a component, even with screen-like code", async () => {
    const grid = view("MediaGrid", "ScrollView { List { Text(t) }.navigationTitle(t) }");
    const user = (name: string) => view(name, "MediaGrid()");
    const result = await kinds({
      "App/MediaGrid.swift": grid,
      "App/A.swift": user("A"),
      "App/B.swift": user("B"),
      "App/C.swift": user("C"),
    });
    expect(result.MediaGrid).toBe("component");
  });

  it("treats component words anywhere in a name as a sign of a component", async () => {
    const nav = "NavigationStack { List { Text(t) }.navigationTitle(t) }";
    const result = await kinds({ "App/StatusRowTextView.swift": view("StatusRowTextView", nav) });
    expect(result.StatusRowTextView).toBe("component");
  });

  it("counts views used with only a trailing closure as reuse", async () => {
    const result = await kinds({
      "App/Panel.swift": view("Panel", "ScrollView { List { Text(t) }.navigationTitle(t) }"),
      "App/A.swift": view("A", "Panel { Text(t) }"),
      "App/B.swift": view("B", "Panel { Text(t) }"),
      "App/C.swift": view("C", "Panel { Text(t) }"),
    });
    expect(result.Panel).toBe("component");
  });

  it("treats the app's own container views as components", async () => {
    const result = await kinds({
      "App/Panel.swift":
        "struct Panel<Content: View>: View { var body: some View { NavigationStack { List { } }.toolbar { } } }",
    });
    expect(result.Panel).toBe("component");
  });

  it("treats a view placed inside another as a part, but not one built in a helper or stored for later", async () => {
    const page = (name: string) => view(name, "ScrollView { List { Text(t) }.navigationTitle(t) }");
    const result = await kinds({
      "App/Host.swift": `${view("Host", "Embedded()")}\nvar drafts: some View { Drafts() }\nlet register = Register()`,
      "App/Embedded.swift": page("Embedded"),
      "App/Drafts.swift": page("Drafts"),
      "App/Register.swift": page("Register"),
    });
    expect(result).toMatchObject({ Embedded: "component", Drafts: "screen", Register: "screen" });
  });

  it("keeps a container a component even when presented, since its content is the page", async () => {
    const result = await kinds({
      "App/Root.swift": view("Root", ".sheet(isPresented: $a) { ModalScreen { Text(t) } }"),
      "App/ModalScreen.swift":
        "struct ModalScreen<Content: View>: View { var body: some View { EmptyView() } }",
    });
    expect(result.ModalScreen).toBe("component");
  });

  it("treats a stored view as indirect, typed or not, and a computed helper the same way", async () => {
    const page = (name: string) => view(name, "ScrollView { List { Text(t) }.navigationTitle(t) }");
    const result = await kinds({
      "App/Host.swift": `${view("Host", "Text(t)")}\nlet a: Detail = Detail()\nvar b = Other()\nvar c: some View { Third() }`,
      "App/Detail.swift": page("Detail"),
      "App/Other.swift": page("Other"),
      "App/Third.swift": page("Third"),
    });
    expect(result).toMatchObject({ Detail: "screen", Other: "screen", Third: "screen" });
  });
});

describe("hostile input", () => {
  speedIt.each([
    ["calls with no newlines", "A()".repeat(150_000)],
    ["unclosed calls", "A(".repeat(150_000)],
    ["cases and calls", "case x: A(".repeat(50_000)],
    ["deeply nested wrappers", `${"Wrap(".repeat(60_000)}${"A()".repeat(60_000)}`],
    [
      "switches deep inside nested blocks",
      `${"if a {".repeat(60_000)}${"switch r { case .x: A() } ".repeat(20_000)}`,
    ],
  ])("stays fast on a hostile file full of %s", async (_, body) => {
    const started = performance.now();
    await kinds({ "App/A.swift": `${view("A")}\n${body}` });
    expect(performance.now() - started).toBeLessThan(3000);
  });
});
