import { describe, expect, it } from "vitest";
import { toDesignMd } from "../../src/output/design-md.js";
import { namedLinks } from "../../src/output/screen-links.js";
import { scanRepo } from "../../src/scan/index.js";
import { scanNotes } from "../../src/scan/notes.js";
import { tempDir } from "../helpers/temp.js";

const IMPORTS = "import androidx.compose.runtime.Composable\n";

async function app(files: Record<string, string>) {
  const scan = await scanRepo(
    await tempDir(Object.fromEntries(Object.entries(files).map(([f, t]) => [f, IMPORTS + t]))),
  );
  const compose = scan.frameworks.find((f) => f.framework === "compose");
  if (!compose) throw new Error("no Compose found");
  const kindOf = (name: string) => compose.screens.find((s) => s.name === name)?.kind;
  const links = namedLinks([compose]).map((l) => `${l.fromName} -> ${l.toName} (${l.opening})`);
  return { scan, compose, kindOf, links };
}

/** A view with nothing page-like about it, so only how the app opens it can make it a screen. */
const plain = (name: string) => `@Composable fun ${name}(onOpen: () -> Unit = {}) { Text("x") }\n`;

describe("Compose screens from Navigation Compose", () => {
  it("makes each destination's view a screen, and links what its block opens, dialogs included", async () => {
    const { kindOf, links } = await app({
      "app/Views.kt": plain("Inbox") + plain("Thread") + plain("Compose") + plain("Avatar"),
      "app/Nav.kt": [
        "@Composable fun AppNav() {",
        "  NavHost(navController, startDestination = InboxRoute) {",
        "    composable<InboxRoute> { Inbox(onOpen = { navController.navigate(ThreadRoute(id)) }) }",
        "    composable<ThreadRoute> { Thread(onOpen = { navController.navigate(ComposeRoute) { popUpTo(InboxRoute) } }) }",
        "    dialog<ComposeRoute> { Compose() }",
        "  }",
        "}",
      ].join("\n"),
    });
    expect(["Inbox", "Thread", "Compose"].map(kindOf)).toEqual(["screen", "screen", "screen"]);
    expect(kindOf("Avatar")).toBe("component");
    expect(links).toEqual(["Inbox -> Thread (push)", "Thread -> Compose (dialog)"]);
  });

  it("reads string routes, constants in templates, an app's own wrapper, and navigate helpers", async () => {
    const { links, kindOf } = await app({
      "app/Views.kt": plain("Home") + plain("Detail"),
      "app/Nav.kt": [
        'object Routes { const val HOME = "home"; const val DETAIL = "detail" }',
        "fun NavGraphBuilder.composableWithFade(route: String, content: @Composable () -> Unit) { composable(route) { content() } }",
        "class AppNavigator(val nav: NavController) {",
        // biome-ignore lint/suspicious/noTemplateCurlyInString: a Kotlin string template, not a JavaScript one.
        '  fun openDetail(id: Long) { nav.navigate("${Routes.DETAIL}/$id") }',
        "}",
        "@Composable fun AppNav(navigator: AppNavigator) {",
        "  NavHost(nav, startDestination = Routes.HOME) {",
        "    composableWithFade(route = Routes.HOME) { Home(onOpen = navigator::openDetail) }",
        // biome-ignore lint/suspicious/noTemplateCurlyInString: a Kotlin string template, not a JavaScript one.
        '    composableWithFade("${Routes.DETAIL}/{id}") { Detail() }',
        '    composable("settings") { }',
        "  }",
        "}",
      ].join("\n"),
    });
    expect([kindOf("Home"), kindOf("Detail")]).toEqual(["screen", "screen"]);
    expect(links).toEqual(["Home -> Detail (push)"]);
  });
});

describe("Compose links, read carefully", () => {
  it("reads helpers called on a receiver, and routes named by a type inside an object", async () => {
    const { links } = await app({
      "app/Views.kt": plain("List") + plain("Podcast"),
      "app/Nav.kt": [
        'sealed class Screen(val route: String) { object List : Screen("list"); object Podcast : Screen("podcast/{id}") }',
        "fun NavController.navigateToPodcast(id: String) { navigate(Screen.Podcast.createRoute(id)) }",
        "@Composable fun Nav() {",
        "  NavHost(navController, Screen.List.route) {",
        "    composable(Screen.List.route) { List(onOpen = { navController.navigateToPodcast(it) }) }",
        "    composable(Screen.Podcast.route) { Podcast() }",
        "  }",
        "}",
      ].join("\n"),
    });
    expect(links).toEqual(["List -> Podcast (push)"]);
  });

  it("keeps a nested host's links to its own destinations, and each app's links within its module", async () => {
    const { links } = await app({
      "phone/src/main/Views.kt": plain("Main") + plain("Feed") + plain("Player"),
      "phone/src/main/Nav.kt": [
        "@Composable fun Nav() {",
        "  NavHost(nav, MainRoute) {",
        "    composable<MainRoute> {",
        "      Main()",
        "      NavHost(inner, FeedRoute) { composable<FeedRoute> { Feed(onOpen = { nav.navigate(PlayerRoute) }) } }",
        "    }",
        "    composable<PlayerRoute> { Player() }",
        "  }",
        "}",
      ].join("\n"),
      "watch/src/main/Views.kt": plain("Player") + plain("Queue"),
      "watch/src/main/Nav.kt": [
        "@Composable fun WatchNav() {",
        "  NavHost(nav, QueueRoute) {",
        "    composable<QueueRoute> { Queue(onOpen = { nav.navigate(PlayerRoute) }) }",
        "    composable<PlayerRoute> { Player() }",
        "  }",
        "}",
      ].join("\n"),
    });
    expect(links).toEqual(["Feed -> Player (push)", "Queue -> Player (push)"]);
  });
});

describe("what isn't a link", () => {
  it("doesn't count going back, asking about the back stack, icons, or a helper merely mentioned", async () => {
    const { links } = await app({
      "app/Views.kt": plain("Home") + plain("Detail"),
      "app/Nav.kt": [
        "class Ui { fun open() { nav.navigate(Home) } }",
        "class Other { fun open() { nav.navigate(Detail) } }",
        "@Composable fun Nav() {",
        "  NavHost(nav, Home) {",
        "    composable<Home> { Home(onOpen = { open }) }",
        "    composable<Detail> {",
        "      val parent = nav.getBackStackEntry<Home>()",
        "      Detail(onOpen = { nav.popBackStack(Home, false) }, icon = Icons.Default.Home)",
        "      x.open()",
        "    }",
        "  }",
        "}",
      ].join("\n"),
    });
    expect(links).toEqual([]);
  });

  it("tells nested string routes apart, and keeps the same pair of routes in two apps", async () => {
    const { links } = await app({
      "phone/src/main/Views.kt":
        plain("Settings") + plain("Notifications") + plain("Queue") + plain("Player"),
      "phone/src/main/Nav.kt": [
        "@Composable fun Nav() {",
        '  NavHost(nav, "settings") {',
        '    composable("settings") { Settings(onOpen = { nav.navigate("settings/notifications") }) }',
        '    composable("settings/notifications") { Notifications() }',
        "    composable<QueueRoute> { Queue(onOpen = { nav.navigate(PlayerRoute) }) }",
        "    composable<PlayerRoute> { Player() }",
        "  }",
        "}",
      ].join("\n"),
      "watch/src/main/Views.kt": plain("Queue") + plain("Player"),
      "watch/src/main/Nav.kt":
        "@Composable fun Nav() { NavHost(nav, QueueRoute) { composable<QueueRoute> { Queue(onOpen = { nav.navigate(PlayerRoute) }) }; composable<PlayerRoute> { Player() } } }",
    });
    expect(links).toEqual([
      "Queue -> Player (push)",
      "Settings -> Notifications (push)",
      "Queue -> Player (push)",
    ]);
  });
});

describe("Compose screens from Navigation 3", () => {
  it("reads entries, back stack additions, and callbacks passed to the function declaring an entry", async () => {
    const { links } = await app({
      "app/Views.kt": plain("Feed") + plain("Topic") + plain("Post"),
      "app/Entries.kt": [
        "fun EntryProviderScope<NavKey>.feedEntry(openPost: (String) -> Unit) {",
        "  entry<FeedKey> { Feed(onOpen = { backStack.add(TopicKey(1)) }) }",
        "}",
        "fun EntryProviderScope<NavKey>.topicEntry() { entry<TopicKey> { Topic() } }",
        "fun EntryProviderScope<NavKey>.postEntry() { entry<PostKey> { Post() } }",
      ].join("\n"),
      "app/Display.kt": [
        "@Composable fun AppDisplay() {",
        "  NavDisplay(backStack, entryProvider = entryProvider {",
        "    feedEntry(openPost = { navigator.navigate(PostKey(it), popUpTo = PopUpTo(FeedKey)) })",
        "    topicEntry()",
        "    postEntry()",
        "  })",
        "}",
      ].join("\n"),
    });
    expect(links).toEqual(["Feed -> Post (push)", "Feed -> Topic (push)"]);
  });
});

describe("Compose screens from Circuit", () => {
  it("finds screens through the app's base class, their views in UI factories, and links from presenters", async () => {
    const { kindOf, links } = await app({
      "app/Screens.kt": [
        "import com.slack.circuit.runtime.screen.Screen",
        "abstract class AppScreen : Screen",
        "object HomeScreen : AppScreen()",
        "data class DetailScreen(val id: Long) : AppScreen()",
      ].join("\n"),
      "app/Home.kt": `${plain("Home")}${plain("Detail")}`,
      "app/UiFactory.kt": [
        "fun uiFor(screen: Screen) = when (screen) {",
        "  is HomeScreen -> ui<HomeState> { state, modifier -> Home() }",
        "  is DetailScreen -> ui<DetailState> { state, modifier -> Detail() }",
        "  else -> null",
        "}",
      ].join("\n"),
      "app/HomePresenter.kt": [
        "fun presenterFor(screen: Screen, navigator: Navigator) = when (screen) { is HomeScreen -> HomePresenter(navigator) }",
        "class HomePresenter(val navigator: Navigator) { fun open(id: Long) = navigator.goTo(DetailScreen(id)) }",
      ].join("\n"),
    });
    expect([kindOf("Home"), kindOf("Detail")]).toEqual(["screen", "screen"]);
    expect(links).toEqual(["Home -> Detail (push)"]);
  });
});

describe("Navigation 3 entries written as a when", () => {
  it("reads `is Key -> NavEntry(key) { … }`", async () => {
    const { links } = await app({
      "app/Views.kt": plain("Home") + plain("Post"),
      "app/Nav.kt": [
        "@Composable fun Nav() {",
        "  NavDisplay(backStack, entryProvider = { key ->",
        "    when (key) {",
        "      is HomeKey -> NavEntry(key) { Home(onOpen = { backStack.add(PostKey) }) }",
        "      is PostKey -> NavEntry(key) { Post() }",
        "    }",
        "  })",
        "}",
      ].join("\n"),
    });
    expect(links).toEqual(["Home -> Post (push)"]);
  });
});

describe("how screens open, where the app starts, and what couldn't be tied", () => {
  it("reads panes, replacing navigation, the start screen, and navigation to a library's screen", async () => {
    const { scan, compose, links } = await app({
      "app/Views.kt": plain("Login") + plain("Topics") + plain("Topic"),
      "app/Nav.kt": [
        "@Composable fun Nav() {",
        "  val backStack = rememberNavBackStack(LoginKey)",
        "  NavDisplay(backStack, entryProvider = entryProvider {",
        "    entry<LoginKey> { Login(onOpen = { backStack.replaceAll(listOf(TopicsKey)) }) }",
        "    entry<TopicsKey>(metadata = ListDetailSceneStrategy.listPane()) { Topics(onOpen = { backStack.add(TopicKey); backStack.add(PlayerKey) }) }",
        "    entry<TopicKey>(metadata = ListDetailSceneStrategy.detailPane()) { Topic() }",
        "  })",
        "}",
      ].join("\n"),
    });
    expect(links).toEqual(["Login -> Topics (replace)", "Topics -> Topic (pane)"]);
    expect(compose.starts).toEqual(["compose:app/Views.kt#Login"]);
    expect(compose.unresolvedLinks).toBe(1);
    expect(toDesignMd(scan)).toContain(
      "How screens open each other: Login → Topics (replaces); Topics → Topic (pane beside). The app starts on Login. 1 navigation call couldn't be tied to two screens",
    );
  });

  it("starts on a host's startDestination or a Circuit back stack's first screen, and lists links in the same order every run", async () => {
    const files = {
      "app/Views.kt": plain("Home") + plain("Detail") + plain("Zebra"),
      "app/Nav.kt": [
        "@Composable fun Nav() {",
        "  NavHost(nav, startDestination = HomeRoute) {",
        "    composable<ZebraRoute> { Zebra(onOpen = { nav.navigate(HomeRoute) }) }",
        "    composable<HomeRoute> { Home(onOpen = { nav.navigate(DetailRoute); nav.navigate(ZebraRoute) }) }",
        "    composable<DetailRoute> { Detail() }",
        "  }",
        "}",
      ].join("\n"),
    };
    const first = await app(files);
    expect(first.compose.starts).toEqual(["compose:app/Views.kt#Home"]);
    expect(first.links).toEqual(["Home -> Detail (push)", "Home -> Zebra (push)", "Zebra -> Home (push)"]);
    expect((await app(files)).links).toEqual(first.links);
    const circuit = await app({
      "app/Screens.kt": "import com.slack.circuit.runtime.screen.Screen\nobject HomeScreen : Screen",
      "app/Home.kt": plain("Home"),
      "app/Ui.kt": "fun ui(s: Screen) = when (s) { is HomeScreen -> ui { Home() } }",
      "app/Main.kt": "fun main() { val backStack = rememberSaveableBackStack(listOf(HomeScreen)) }",
    });
    expect(circuit.compose.starts).toEqual(["compose:app/Home.kt#Home"]);
  });
});

describe("starts and calls that aren't navigation", () => {
  it("starts on the main graph's first screen, not every nested graph's", async () => {
    const { compose } = await app({
      "app/Views.kt": plain("Login") + plain("Home"),
      "app/Nav.kt": [
        "@Composable fun Nav() {",
        "  NavHost(nav, startDestination = MainGraph) {",
        "    navigation<AuthGraph>(startDestination = LoginRoute) { composable<LoginRoute> { Login() } }",
        "    navigation<MainGraph>(startDestination = HomeRoute) { composable<HomeRoute> { Home() } }",
        "  }",
        "}",
      ].join("\n"),
    });
    expect(compose.starts).toEqual(["compose:app/Views.kt#Home"]);
  });

  it("doesn't take adding to a list or replacing text for navigation", async () => {
    const { compose, links } = await app({
      "app/Views.kt": [
        "@Composable fun Home(onOpen: () -> Unit = {}) { focus.add(FocusRequester()); colors.add(Color.Red) }",
        '@Composable fun Detail(route: String) { Text(route.replace("home", "Home")) }',
      ].join("\n"),
      "app/Nav.kt":
        '@Composable fun Nav() { NavHost(nav, "home") { composable("home") { Home() }; composable("detail") { Detail("x") } } }',
    });
    expect(links).toEqual([]);
    expect(compose.unresolvedLinks).toBeUndefined();
  });
});

describe("navigation written through an app's own state class", () => {
  it("follows routes held in a variable, helpers calling helpers, and a screen opening itself", async () => {
    const { links, compose } = await app({
      "app/Views.kt": plain("Discover") + plain("Podcast") + plain("Player"),
      "app/AppState.kt": [
        "class AppState(val nav: NavHostController) {",
        "  private fun navigate(screen: Screen) { nav.navigate(screen.route) }",
        "  fun navigateToDiscover() { navigate(Screen.Discover) }",
        "  fun showPodcast(uri: String) { val screen = Screen.Podcast(uri); navigate(screen) }",
        "  fun playEpisode() { navigate(Screen.Player) }",
        "  fun backToHome() { nav.popBackStack(); navigateToDiscover() }",
        "}",
      ].join("\n"),
      "app/Nav.kt": [
        "@Composable fun Nav(state: AppState) {",
        "  NavHost(state.nav, Screen.Discover.route, ) {",
        "    composable(Screen.Discover.route) { Discover(onOpen = { state.showPodcast(it) }) }",
        "    composable(Screen.Podcast.route) { Podcast(onOpen = { state.playEpisode(); state.showPodcast(other) }) }",
        "    composable(Screen.Player.route) { Player(onOpen = { state.backToHome() }) }",
        "  }",
        "}",
      ].join("\n"),
      "app/Main.kt":
        "@Composable fun App() { val navigationState = rememberNavigationState(startKey = Screen.Discover) }",
    });
    expect(links).toEqual([
      "Discover -> Podcast (push)",
      "Player -> Discover (push)",
      "Podcast -> Player (push)",
      "Podcast -> Podcast (push)",
    ]);
    expect(compose.starts).toEqual(["compose:app/Views.kt#Discover"]);
  });

  it("reads Circuit screens shown as a dialog or a bottom sheet", async () => {
    const { links } = await app({
      "app/Screens.kt":
        "import com.slack.circuit.runtime.screen.Screen\nobject HomeScreen : Screen\nobject AccountScreen : Screen\nobject TrackScreen : Screen",
      "app/Views.kt": plain("Home") + plain("Account") + plain("Track"),
      "app/Ui.kt":
        "fun ui(s: Screen) = when (s) { is AccountScreen -> ui { Account() }; is TrackScreen -> ui { Track() }; else -> null }",
      "app/HomeUi.kt": [
        "fun homeUi(s: Screen) = when (s) { is HomeScreen -> ui { Home() } }",
        "suspend fun open() { overlayHost.showInDialog(AccountScreen, navigator::goTo); overlayHost.showInBottomSheet(TrackScreen) }",
      ].join("\n"),
      "app/HomePresenter.kt":
        "fun presenter(s: Screen) = when (s) { is HomeScreen -> HomePresenter() }\nclass HomePresenter { fun open() = navigator.goTo(AccountScreen) }",
    });
    expect(links).toEqual(["Home -> Account (dialog)", "Home -> Track (sheet)"]);
  });
});

describe("Compose views", () => {
  it("makes what an Activity draws first a screen, leaves previews out, and keeps containers components", async () => {
    const { compose, kindOf } = await app({
      "app/MainActivity.kt":
        "class MainActivity { fun onCreate() { setContent { IntentEffect(); AppTheme { Root() } } } }\n@Composable fun IntentEffect() { }\n@Composable fun AppTheme(content: @Composable () -> Unit) { content() }",
      "app/Views.kt": [
        plain("Root"),
        "@Preview @Composable fun RootPreview() { Root() }",
        "@Composable fun Section(title: String, content: @Composable () -> Unit) { Scaffold { LazyColumn { } } }",
      ].join(""),
    });
    expect(kindOf("Root")).toBe("screen");
    expect(compose.screens.some((s) => s.name === "RootPreview")).toBe(false);
    expect(kindOf("Section")).toBe("component");
  });

  it("leaves out every kind of preview, reads an expression body's trailing block, and keeps setContent to its block", async () => {
    const { compose, kindOf } = await app({
      "app/Views.kt": [
        "@PreviewLightDark @Composable fun APreview() { Card() }",
        "@DevicePreviews @Composable fun BPreview() { Card() }",
        plain("Card"),
        "@Composable fun Feed() = Column(Modifier) { Scaffold { TopAppBar(title = {}); LazyColumn { } } }",
      ].join(""),
      "app/MainActivity.kt": [
        "class MainActivity { fun onCreate() { setContent { val x = 1 } } }",
        "@Composable fun Later() { Card() }",
      ].join("\n"),
    });
    expect(compose.screens.map((s) => s.name).sort()).toEqual(["Card", "Feed", "Later"]);
    expect(kindOf("Feed")).toBe("screen");
    expect(kindOf("Later")).toBe("component");
  });

  it("says which navigation libraries it doesn't read yet", async () => {
    const { scan } = await app({
      "app/Root.kt": `import com.bumble.appyx.navigation.node.Node\n${plain("Root")}`,
    });
    expect(scanNotes(scan)).toContain(
      "This app moves between screens with Appyx, which Designmap doesn't read yet: its screens are found by what they contain, and the links between them aren't listed.",
    );
  });

  it("lists how screens open each other in DESIGN.md", async () => {
    const { scan } = await app({
      "app/Views.kt": plain("Inbox") + plain("Thread"),
      "app/Nav.kt":
        "@Composable fun Nav() { NavHost(nav, Inbox) { composable<InboxRoute> { Inbox(onOpen = { nav.navigate(ThreadRoute) }) }; bottomSheet<ThreadRoute> { Thread() } } }",
    });
    expect(toDesignMd(scan)).toContain("How screens open each other: Inbox → Thread (sheet).");
  });
});

describe("hostile Compose navigation", () => {
  it.each([
    [
      "thousands of destinations and links",
      Array.from(
        { length: 3000 },
        (_, i) => `composable<R${i}> { V(onOpen = { nav.navigate(R${i + 1}) }) }\n`,
      ).join(""),
    ],
    [
      "thousands of navigate helpers",
      Array.from({ length: 3000 }, (_, i) => `fun go${i}() { nav.navigate(R${i}) }\n`).join(""),
    ],
    ["destinations nested thousands deep", `${"composable<R> { ".repeat(2000)}${"} ".repeat(2000)}`],
    ["functions nested thousands deep", `${"fun a() { nav.navigate(R) ".repeat(2000)}${"} ".repeat(2000)}`],
    ["thousands of setContent blocks", "setContent { x }\n".repeat(5000)],
    [
      "thousands of Circuit screens",
      `import com.slack.circuit.runtime.screen.Screen\n${Array.from({ length: 3000 }, (_, i) => `object S${i} : Screen\nis S${i} -> ui { V() }\n`).join("")}`,
    ],
  ])("reads %s quickly", async (_, text) => {
    const started = performance.now();
    await app({ "app/Hostile.kt": `${plain("V")}${text}` });
    expect(performance.now() - started).toBeLessThan(3_000);
  });
});
