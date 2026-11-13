import { describe, expect, it } from "vitest";
import { namedLinks } from "../../src/output/screen-links.js";
import { scanRepo } from "../../src/scan/index.js";
import { speedIt } from "../helpers/speed.js";
import { tempDir } from "../helpers/temp.js";

async function app(files: Record<string, string>) {
  const scan = await scanRepo(
    await tempDir(Object.fromEntries(Object.entries(files).map(([f, t]) => [f, `import SwiftUI\n${t}`]))),
  );
  const swiftui = scan.frameworks.find((f) => f.framework === "swiftui");
  if (!swiftui) throw new Error("no SwiftUI found");
  const links = namedLinks([swiftui]).map((l) => `${l.fromName} -> ${l.toName} (${l.opening})`);
  return { swiftui, links };
}

const page = (name: string) => `struct ${name}: View { var body: some View { Text(t) } }\n`;

describe("SwiftUI links", () => {
  it("reads how each presenter opens a screen", async () => {
    const { links } = await app({
      "App/Pages.swift": ["Detail", "Settings", "Player", "Info", "Profile", "Feed", "Inbox", "Item"]
        .map(page)
        .join(""),
      "App/Home.swift": [
        "struct Home: View {",
        "  var body: some View {",
        "    NavigationStack {",
        "      NavigationLink(destination: Detail()) { Text(t) }",
        "      Text(t).navigationDestination(for: Int.self) { _ in Profile() }",
        "      Text(t).sheet(isPresented: $s) { Settings() }",
        "      Text(t).fullScreenCover(isPresented: $p) { Player() }",
        "      Text(t).popover(isPresented: $i) { Info() }",
        "    }",
        "  }",
        "}",
        'struct Tabs: View { var body: some View { TabView { Feed().tabItem { Text(t) }; Tab("Inbox") { Inbox() } } } }',
        "struct Split: View { var body: some View { NavigationSplitView { Text(t) } detail: { Item() } } }",
      ].join("\n"),
    });
    expect(links).toEqual([
      "Home -> Detail (push)",
      "Home -> Info (popover)",
      "Home -> Player (fullScreen)",
      "Home -> Profile (push)",
      "Home -> Settings (sheet)",
      "Split -> Item (pane)",
      "Tabs -> Feed (tab)",
      "Tabs -> Inbox (tab)",
    ]);
  });

  it("starts on what the app's window shows, and reads views conforming to a protocol named …View", async () => {
    const { swiftui, links } = await app({
      "App/App.swift": "@main struct MyApp: App { var body: some Scene { WindowGroup { Home() } } }",
      "App/Home.swift": [
        "struct Home: ConnectedView { func body(props: Props) -> some View { NavigationLink(destination: Detail()) { Text(t) } } }",
        page("Detail").trim(),
      ].join("\n"),
    });
    expect(swiftui.starts).toEqual(["swiftui:App/Home.swift#Home"]);
    expect(links).toEqual(["Home -> Detail (push)"]);
  });

  it("links through an app's router: its cases, and the screens whose navigation names them", async () => {
    const { links } = await app({
      "App/Pages.swift": page("AccountDetail") + page("SettingsView") + page("Timeline"),
      "App/Router.swift": [
        "enum RouterDestination: Hashable { case accountDetail(id: String) }",
        "enum SheetDestination: Identifiable { case settings }",
        "extension View {",
        "  func withAppRouter() -> some View {",
        "    navigationDestination(for: RouterDestination.self) { destination in",
        "      switch destination {",
        "      case .accountDetail(let id): AccountDetail()",
        "      }",
        "    }",
        "  }",
        "  func withSheets(_ sheet: Binding<SheetDestination?>) -> some View {",
        "    sheet(item: sheet) { destination in",
        "      switch destination {",
        "      case .settings: SettingsView()",
        "      }",
        "    }",
        "  }",
        "}",
      ].join("\n"),
      "App/Timeline.swift": [
        "struct Home: View {",
        "  var body: some View {",
        '    Button("a") { routerPath.navigate(to: .accountDetail(id: x)) }',
        '    Button("s") { routerPath.presentedSheet = .settings }',
        '    Button("x") { items.append(.settings); pages.append(.accountDetail(id: x)) }',
        "  }",
        "}",
      ].join("\n"),
    });
    expect(links).toEqual(["Home -> AccountDetail (push)", "Home -> SettingsView (sheet)"]);
  });

  it("reads namespaced views, NavigationLink values, the enum's written name, and one view shown for two cases", async () => {
    const { links } = await app({
      "App/Pages.swift":
        page("Timeline") +
        "enum StatusEditor { struct MainView: View { var body: some View { Text(t) } } }\n",
      "App/Router.swift": [
        "extension View {",
        "  func withAppRouter() -> some View {",
        "    navigationDestination(for: RouterDestination.self) { destination in",
        "      switch destination {",
        "      case .hashTag(let tag): Timeline()",
        "      case .trending: Timeline()",
        "      }",
        "    }",
        "  }",
        "  func withSheets(_ sheet: Binding<SheetDestination?>) -> some View {",
        "    sheet(item: sheet) { destination in switch destination { case .editor: StatusEditor.MainView() } }",
        "  }",
        "}",
      ].join("\n"),
      "App/Explore.swift": [
        "struct Explore: View {",
        "  var body: some View {",
        "    NavigationLink(value: RouterDestination.trending) { Text(t) }",
        '    Button("h") { routerPath.navigate(to: RouterDestination.hashTag(tag: t)) }',
        '    Button("e") { routerPath.presentedSheet = .editor }',
        "  }",
        "}",
      ].join("\n"),
    });
    expect(links).toEqual(["Explore -> MainView (sheet)", "Explore -> Timeline (push)"]);
  });

  it("keeps the pages a view's own router shows, as links from that view, tabs when it switches over a tab", async () => {
    const { links } = await app({
      "App/Pages.swift": page("Feed") + page("Search") + page("Profile"),
      "App/Root.swift": [
        "struct Root: View {",
        "  var body: some View {",
        "    switch selectedTab {",
        "    case .feed: Feed()",
        "    case .search: Search()",
        "    case .profile: Profile()",
        "    }",
        "  }",
        "}",
      ].join("\n"),
    });
    expect(links).toEqual(["Root -> Feed (tab)", "Root -> Profile (tab)", "Root -> Search (tab)"]);
  });
});

describe("what isn't a SwiftUI link", () => {
  const router = [
    "extension View {",
    "  func withAppRouter() -> some View {",
    "    navigationDestination(for: RouterDestination.self) { destination in",
    "      switch destination {",
    "      case .trending, .popular: Trending()",
    "      case .profile: Profile()",
    "      case .settings: Settings()",
    "      case let .user(id): UserPage()",
    "      default: Fallback()",
    "      }",
    "    }",
    "  }",
    "}",
  ].join("\n");

  it("doesn't take look-alike names, other stacks, going back, initial values or another enum's case for navigation", async () => {
    const { links } = await app({
      "App/Pages.swift":
        page("Trending") + page("Profile") + page("Settings") + page("UserPage") + page("Fallback"),
      "App/Router.swift": router,
      "App/Home.swift": [
        "struct Home: View {",
        "  @State var destination = RouterDestination.settings",
        "  var body: some View {",
        '    Button("a") { discoveryFilter = .trending; spreadsheetMode = .settings; recoveryState = .profile }',
        '    Button("b") { undoStack.push(.settings); router.showAlert(.profile); router.navigateBack(to: .trending) }',
        '    Button("c") { path.append(AnalyticsEvent.profile) }',
        "  }",
        "}",
      ].join("\n"),
    });
    expect(links).toEqual([]);
  });

  it("reads every case a view is shown for, but not `default`", async () => {
    const { links } = await app({
      "App/Pages.swift":
        page("Trending") + page("Profile") + page("Settings") + page("UserPage") + page("Fallback"),
      "App/Router.swift": router,
      "App/Home.swift": [
        "struct Home: View {",
        "  var body: some View {",
        '    Button("a") { routerPath.navigate(to: .popular) }',
        '    Button("b") { routerPath.navigate(to: .user(id: 1)) }',
        "  }",
        "}",
      ].join("\n"),
    });
    expect(links).toEqual(["Home -> Trending (push)", "Home -> UserPage (push)"]);
  });

  it("keeps a tab switch's cases and a window's out of navigation, and a table's layout out of tabs", async () => {
    const { links } = await app({
      "App/Pages.swift":
        page("Feed") + page("Search") + page("Inbox") + page("Grid") + page("Rows") + page("Cards"),
      "App/Root.swift": [
        "struct Root: View { var body: some View { switch selectedTab { case .feed: Feed(); case .search: Search(); case .inbox: Inbox() } } }",
        "struct Gallery: View { var body: some View { switch tableLayout { case .grid: Grid(); case .rows: Rows(); case .cards: Cards() } } }",
        'struct Other: View { var body: some View { Button("s") { path.append(.search) } } }',
      ].join("\n"),
    });
    expect(links).toEqual([
      "Gallery -> Cards (push)",
      "Gallery -> Grid (push)",
      "Gallery -> Rows (push)",
      "Root -> Feed (tab)",
      "Root -> Inbox (tab)",
      "Root -> Search (tab)",
    ]);
  });

  it("credits a link made from a row to the screen holding the row", async () => {
    const { swiftui, links } = await app({
      "App/Pages.swift": page("PostDetail"),
      "App/Feed.swift": [
        "struct Feed: View { var body: some View { NavigationStack { List { PostRow() }.navigationTitle(t).toolbar { } } } }",
        "struct PostRow: View { var body: some View { NavigationLink(destination: PostDetail()) { Text(t) } } }",
      ].join("\n"),
    });
    expect(links).toEqual(["Feed -> PostDetail (push)"]);
    expect(swiftui.links?.[0]?.via).toBe("swiftui:App/Feed.swift#PostRow");
  });

  it("doesn't count a namespaced type sharing a view's name as placing it, nor a non-view protocol named …View", async () => {
    const files: Record<string, string> = {
      "App/Settings.swift":
        "struct Settings: View { var body: some View { NavigationStack { List { }.navigationTitle(t).toolbar { } } } }\nstruct LoginStub: LoginView { func show() { } }",
    };
    for (const n of [1, 2, 3])
      files[`App/Use${n}.swift`] =
        `struct Use${n}: View { var body: some View { VStack { Row(p: AppConfig.Settings(id: 1)) } } }`;
    const { swiftui } = await app(files);
    expect(swiftui.screens.find((s) => s.name === "Settings")?.kind).toBe("screen");
    expect(swiftui.screens.some((s) => s.name === "LoginStub")).toBe(false);
  });
});

describe("SwiftUI links made away from the screen", () => {
  const router = [
    "extension View {",
    "  func withAppRouter() -> some View {",
    "    navigationDestination(for: RouterDestination.self) { destination in",
    "      switch destination {",
    "      case .detail: Detail()",
    "      case .about: Wrapper { About() }",
    "      case .push: if let s = subs.first(where: { $0.on }) { Wrapper { Push(s) } }",
    "      }",
    "    }",
    "  }",
    "}",
    "struct Wrapper<Content: View>: View { @ViewBuilder var content: Content; var body: some View { NavigationStack { content } } }",
  ].join("\n");
  const screen = (name: string, inner: string) =>
    `struct ${name}: View { var body: some View { NavigationStack { List { ${inner} }.navigationTitle(t).toolbar { } } } }\n`;

  it("opens the page inside the app's own wrapper, also behind an `if let` with a closure", async () => {
    const { links } = await app({
      "App/Pages.swift": page("Detail") + page("About") + page("Push"),
      "App/Router.swift": router,
      "App/Home.swift": screen(
        "Home",
        'Button("a") { routerPath.navigate(to: .about) }; Button("p") { routerPath.navigate(to: .push) }',
      ),
    });
    expect(links).toEqual(["Home -> About (push)", "Home -> Push (push)"]);
  });

  it("credits a view model's navigation to the view owning it, not the parts it's passed to", async () => {
    const { links } = await app({
      "App/Pages.swift": page("Detail") + page("About") + page("Push"),
      "App/Router.swift": router,
      "App/Row.swift": [
        "@Observable class RowModel { func open() { routerPath.navigate(to: .detail) } }",
        "struct Row: View { @State var viewModel: RowModel; var body: some View { RowHeader(viewModel: viewModel); RowText(viewModel: viewModel) } }",
        "struct RowHeader: View { let viewModel: RowModel; var body: some View { Text(t) } }",
        "struct RowText: View { let viewModel: RowModel; var body: some View { Text(t) } }",
        "struct Other: View { let viewModel: RowModel; var body: some View { Text(t) } }",
        "struct More: View { let viewModel: RowModel; var body: some View { Text(t) } }",
      ].join("\n"),
      "App/Feed.swift": screen("Feed", "Row(viewModel: m)"),
    });
    expect(links).toEqual(["Feed -> Detail (push)"]);
  });

  it("credits a row to every screen holding it, through a list another screen holds", async () => {
    const { links } = await app({
      "App/Pages.swift": page("Detail"),
      "App/Rows.swift": [
        "struct Row: View { var body: some View { NavigationLink(destination: Detail()) { Text(t) } } }",
        "struct RowList: View { var body: some View { ForEach(items) { _ in Row() } } }",
      ].join("\n"),
      "App/Feed.swift": screen("Feed", "Row()"),
      "App/Timeline.swift": screen("Timeline", "RowList()"),
    });
    expect(links).toEqual(["Feed -> Detail (push)", "Timeline -> Detail (push)"]);
  });
});

describe("SwiftUI navigation that isn't what it looks like", () => {
  const pages =
    page("PostView") + page("SearchView") + page("SettingsView") + page("ProfileView") + page("AboutView");
  const router = [
    "extension View {",
    "  func withAppRouter() -> some View {",
    "    navigationDestination(for: RouterDestination.self) { destination in",
    "      switch destination {",
    "      case .post:",
    "        if case .loaded = state { PostView() }",
    "      case .search: SearchView(); case .profile: ProfileView(); case .settings: SettingsView()",
    "      }",
    "    }",
    "  }",
    "  func withSheets(_ sheet: Binding<SheetDestination?>) -> some View {",
    "    sheet(item: sheet) { d in switch d { case .about: AboutView(); case .settings: AccountSettingsView() } }",
    "  }",
    "}",
  ].join("\n");

  it("keeps a view model declared in a view's extension to that view", async () => {
    const vm = (view: string, to: string) =>
      `struct ${view}: View { @State private var viewModel = ViewModel(); var body: some View { Text(t) } }\n` +
      `extension ${view} { @Observable final class ViewModel { func go() { router.navigate(to: .${to}) } } }`;
    const { links } = await app({
      "App/Pages.swift": pages + page("AccountSettingsView"),
      "App/Router.swift": router,
      "App/A.swift": vm("AView", "post"),
      "App/B.swift": vm("BView", "search"),
    });
    expect(links).toEqual(["AView -> PostView (push)", "BView -> SearchView (push)"]);
  });

  it("doesn't credit a router's own methods to the view holding the router", async () => {
    const { links } = await app({
      "App/Pages.swift": pages + page("AccountSettingsView"),
      "App/Router.swift": router,
      "App/Nav.swift": [
        "@Observable final class Router { var path = NavigationPath(); func reset() { path.append(.profile) } }",
        "struct ContentView: View { @State private var router = Router(); var body: some View { Text(t) } }",
      ].join("\n"),
    });
    expect(links).toEqual([]);
  });

  it("picks the router whose enum the call writes, and reads a case label even past a nested `if case`", async () => {
    const { links } = await app({
      "App/Pages.swift": pages + page("AccountSettingsView"),
      "App/Router.swift": router,
      "App/Home.swift": [
        'struct Home: View { var body: some View { Button("a") { path.append(SheetDestination.settings) } } }',
        'struct Feed: View { var body: some View { Button("b") { path.append(RouterDestination.settings); router.navigate(to: .post) } } }',
      ].join("\n"),
    });
    expect(links).toEqual([
      "Feed -> PostView (push)",
      "Feed -> SettingsView (push)",
      "Home -> AccountSettingsView (sheet)",
    ]);
  });

  it("doesn't read default parameter values or long-typed initial values as navigation", async () => {
    const { links } = await app({
      "App/Pages.swift": pages + page("AccountSettingsView"),
      "App/Router.swift": router,
      "App/Home.swift": [
        "struct Home: View {",
        "  @State private var currentDestination: AppNavigation.RouterDestination = .post",
        "  init(destination: RouterDestination = .profile) {}",
        "  func open(sheet: SheetDestination = .about) {}",
        "  var body: some View { Text(t) }",
        "}",
      ].join("\n"),
    });
    expect(links).toEqual([]);
  });
});

describe("SwiftUI navigation across files and routers", () => {
  const router = (extra = "") =>
    [
      "extension View {",
      "  func withAppRouter() -> some View {",
      "    navigationDestination(for: AppRoute.self) { d in",
      "      switch d {",
      "      case .outer:",
      "        switch state { case .inner: Text(t); default: Text(t) }",
      "        Detail()",
      "      case .post: PostView(); case .search: SearchView()",
      "      }",
      "    }",
      "    .sheet(item: $sheet) { d in switch d { case .detail: SheetDetail(); case .about: AboutView(); case .info: InfoView() } }",
      `    ${extra}`,
      "  }",
      "}",
    ].join("\n");
  const pages = ["Detail", "PostView", "SearchView", "SheetDetail", "AboutView", "InfoView", "CoverDetail"]
    .map(page)
    .join("");

  it("reads a view model's navigation from a file that doesn't import SwiftUI", async () => {
    const dir = await tempDir({
      "App/Pages.swift": `import SwiftUI\n${pages}`,
      "App/Router.swift": `import SwiftUI\n${router()}`,
      "App/Home.swift":
        "import SwiftUI\nstruct Home: View { @State var model: HomeModel; var body: some View { Text(t) } }",
      "App/HomeModel.swift":
        "import Observation\n@Observable class HomeModel { func open() { router.navigate(to: .post) } }",
    });
    const swiftui = (await scanRepo(dir)).frameworks.find((f) => f.framework === "swiftui");
    const links = namedLinks(swiftui ? [swiftui] : []).map(
      (l) => `${l.fromName} -> ${l.toName} (${l.opening})`,
    );
    expect(links).toEqual(["Home -> PostView (push)"]);
  });

  it("keeps two files' same-named private view models apart", async () => {
    const file = (view: string, to: string) =>
      `private class Model { func go() { router.navigate(to: .${to}) } }\nstruct ${view}: View { @State private var model = Model(); var body: some View { Text(t) } }`;
    const { links } = await app({
      "App/Pages.swift": pages,
      "App/Router.swift": router(),
      "App/A.swift": file("AView", "post"),
      "App/B.swift": file("BView", "search"),
    });
    expect(links).toEqual(["AView -> PostView (push)", "BView -> SearchView (push)"]);
  });

  it("reads a case's label past a nested switch, and a sheet's enum from its own presenter only", async () => {
    const { links } = await app({
      "App/Pages.swift": pages,
      "App/Router.swift": router(),
      "App/Home.swift": [
        "struct Home: View { var body: some View {",
        '  Button("o") { router.navigate(to: .outer) }',
        '  Button("s") { presentedSheet = SheetRoute.detail }',
        "} }",
      ].join("\n"),
    });
    expect(links).toEqual(["Home -> Detail (push)", "Home -> SheetDetail (sheet)"]);
  });

  it("tells a full-screen cover from a sheet sharing a case, and reads `present` as a sheet", async () => {
    const cover =
      ".fullScreenCover(item: $cover) { d in switch d { case .detail: CoverDetail(); case .post: PostView(); case .search: SearchView() } }";
    const { links } = await app({
      "App/Pages.swift": pages,
      "App/Router.swift": router(cover),
      "App/Home.swift": [
        "struct Home: View { var body: some View {",
        '  Button("c") { presentedFullScreenCover = .detail }',
        '  Button("p") { router.present(.detail) }',
        "} }",
      ].join("\n"),
    });
    expect(links).toEqual(["Home -> CoverDetail (fullScreen)", "Home -> SheetDetail (sheet)"]);
  });

  it("counts a link from a part too deep inside a screen to credit, rather than showing it from the part", async () => {
    const chain = ["P1", "P2", "P3", "P4", "P5"];
    const files: Record<string, string> = {
      "App/Pages.swift": page("Detail"),
      "App/Home.swift":
        "struct Home: View { var body: some View { NavigationStack { List { P5() }.navigationTitle(t).toolbar { } } } }",
      "App/Parts.swift": [
        "struct P1: View { var body: some View { NavigationLink(destination: Detail()) { Text(t) } } }",
        ...chain
          .slice(1)
          .map((p, i) => `struct ${p}: View { var body: some View { VStack { ${chain[i]}() } } }`),
      ].join("\n"),
    };
    const { swiftui, links } = await app(files);
    expect(links).toEqual([]);
    expect(swiftui.unresolvedLinks).toBeGreaterThan(0);
  });
});

describe("hostile SwiftUI navigation", () => {
  speedIt("reads thousands of presentations and router calls quickly", async () => {
    const views = Array.from(
      { length: 2000 },
      (_, i) =>
        `struct V${i}: View { var body: some View { Text(t).sheet(isPresented: $s) { V${(i + 1) % 2000}() } } }`,
    );
    const calls = Array.from({ length: 2000 }, () => "routerPath.navigate(to: .accountDetail(id: x))");
    const router =
      "extension View { func r() -> some View { navigationDestination(for: D.self) { d in switch d { case .accountDetail: V0(); case .b: V1(); case .c: V2() } } } }";
    const started = performance.now();
    const { links } = await app({
      "App/Views.swift": views.join("\n"),
      "App/Router.swift": router,
      "App/Calls.swift": `struct Caller: View { var body: some View { ${calls.join("; ")} } }`,
    });
    expect(performance.now() - started).toBeLessThan(3_000);
    expect(links).toContain("Caller -> V0 (push)");
  });

  speedIt("finds the holders of thousands of view models quickly", async () => {
    const models = Array.from(
      { length: 4000 },
      (_, i) =>
        `@Observable class M${i} { func go() { router.navigate(to: .a) } }\nstruct H${i}: View { @State var model: M${i}; var body: some View { Text(t) } }`,
    );
    const router =
      "extension View { func r() -> some View { navigationDestination(for: D.self) { d in switch d { case .a: A(); case .b: B(); case .c: C() } } } }";
    const started = performance.now();
    const files = Object.fromEntries(
      Array.from({ length: 40 }, (_, f) => [
        `App/Models${f}.swift`,
        models.slice(f * 100, f * 100 + 100).join("\n"),
      ]),
    );
    const { links } = await app({
      ...files,
      "App/Router.swift": router,
      "App/Pages.swift": page("A") + page("B") + page("C"),
    });
    expect(performance.now() - started).toBeLessThan(3_000);
    expect(links).toContain("H0 -> A (push)");
  });

  speedIt("reads a file with one very long name quickly, beside an app's router", async () => {
    const started = performance.now();
    await app({
      "App/Router.swift":
        "extension View { func r() -> some View { navigationDestination(for: D.self) { d in switch d { case .a: A(); case .b: B(); case .c: C() } } } }",
      "App/Pages.swift": page("A") + page("B") + page("C"),
      "App/Long.swift": `let x = ${"pathsheetcover".repeat(30_000)}`,
    });
    expect(performance.now() - started).toBeLessThan(3_000);
  });
});
