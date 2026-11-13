import { describe, expect, it } from "vitest";
import { scanRepo } from "../../src/scan/index.js";
import { speedIt } from "../helpers/speed.js";
import { tempDir } from "../helpers/temp.js";

const RN = 'import { View, Text, FlatList } from "react-native";\n';
const MANIFEST = { "package.json": '{ "dependencies": { "react-native": "0.76.0" } }' };
/** A component with nothing page-like about it, so only how the app opens it can make it a screen. */
const plain = (name: string) => `export function ${name}() { return <Text>x</Text>; }\n`;

async function app(files: Record<string, string>) {
  return scanned(await tempDir({ ...MANIFEST, ...files }));
}

async function scanned(root: string) {
  const scan = await scanRepo(root);
  const screens = scan.frameworks.find((f) => f.framework === "react-native")?.screens ?? [];
  const kindOf = (name: string) => screens.find((s) => s.name === name)?.kind;
  return { screens, kindOf };
}

describe("React Native screens from React Navigation", () => {
  it("takes what a navigator's screens show for screens: a component, getComponent, or a children function", async () => {
    const { kindOf } = await app({
      "src/Profile.tsx": `${RN}export default function Profile() { return <Text>x</Text>; }`,
      "src/views.tsx": RN + plain("Feed") + plain("Settings") + plain("Badge"),
      "src/Nav.tsx": [
        RN,
        'import Profile from "./Profile";',
        'import { Feed, Settings } from "./views";',
        "export function Nav() { return (<Stack.Navigator>",
        '  <Stack.Screen name="Profile" component={Profile} />',
        '  <Stack.Screen name="Feed" getComponent={() => Feed} />',
        '  <Stack.Screen name="Settings">{(props) => <Settings {...props} />}</Stack.Screen>',
        "</Stack.Navigator>); }",
      ].join("\n"),
    });
    expect([kindOf("Profile"), kindOf("Feed"), kindOf("Settings"), kindOf("Badge")]).toEqual([
      "screen",
      "screen",
      "screen",
      "component",
    ]);
  });

  it("reads static screens configs and an app's own stack creators, through requires", async () => {
    const { kindOf } = await app({
      "src/views.tsx": RN + plain("Home") + plain("Account"),
      "src/pages/Wallet.tsx": `${RN}function Wallet() { return <Text>x</Text>; }\nexport default Wallet;`,
      "src/pages/Help.ios.tsx": `${RN}export default function Help() { return <Text>x</Text>; }`,
      "src/Nav.tsx": [
        RN,
        'import { Home, Account } from "./views";',
        "const Root = createNativeStackNavigator({ screens: { Home, Account: { screen: Account } } });",
        'const loadWallet = () => require("./pages/Wallet").default;',
        'const Modal = createModalStackNavigator({ [SCREENS.WALLET]: loadWallet, [SCREENS.HELP]: () => require("./pages/Help").default });',
      ].join("\n"),
    });
    expect(["Home", "Account", "Wallet", "Help"].map(kindOf)).toEqual([
      "screen",
      "screen",
      "screen",
      "screen",
    ]);
  });

  it("keeps containers, rows and parts reused across screens components, and reads class and wrapped components", async () => {
    const { kindOf, screens } = await app({
      "src/Shell.tsx": `${RN}export function Shell({ children }) { return <View><FlatList data={[]} renderItem={null} />{children}</View>; }`,
      "src/Row.tsx": `${RN}export const Row = memo(function Row() { return <Text>x</Text>; });`,
      "src/Legacy.tsx": `${RN}export class LegacyScreen extends React.PureComponent { render() { return <View><FlatList data={[]} renderItem={null} /></View>; } }`,
      "src/A.tsx": `${RN}export const A = () => <Shell><Row /></Shell>;`,
      "src/B.tsx": `${RN}export const B = () => <Row />;`,
      "src/C.tsx": `${RN}export const C = () => <Row />;`,
      "src/Nav.tsx": `${RN}import { Shell } from "./Shell";\nexport const Nav = () => <Stack.Screen name="Shell" component={Shell} />;`,
    });
    expect([kindOf("Shell"), kindOf("Row"), kindOf("LegacyScreen")]).toEqual([
      "component",
      "component",
      "screen",
    ]);
    expect(screens.map((s) => s.name)).toContain("A");
  });
});

describe("React Native components the code shows in other ways", () => {
  it("lists a component placed as JSX that draws nothing itself, and takes a modal's whole content for a screen", async () => {
    const { kindOf } = await app({
      "src/Header.tsx": `${RN}const HeaderActions = () => { useLayoutEffect(() => {}); return null; };\nexport const Room = () => <HeaderActions />;`,
      "src/Share.tsx": `${RN}import { Recipients } from "./Recipients";\nexport const Share = () => <Modal visible><Recipients /></Modal>;`,
      "src/Recipients.tsx": RN + plain("Recipients"),
      "src/Both.tsx": `${RN}export const Both = () => <Modal visible><Text>a</Text><Text>b</Text></Modal>;`,
    });
    expect([kindOf("HeaderActions"), kindOf("Recipients")]).toEqual(["component", "screen"]);
  });
});

describe("React Native screens from Expo Router", () => {
  it("takes each route file's component for a screen and a layout for a container, under the routes' own folder", async () => {
    const { kindOf } = await app({
      "package.json": '{ "dependencies": { "react-native": "0.76.0", "expo-router": "4.0.0" } }',
      "app/routes/_layout.tsx": `${RN}export default function RootLayout() { return <Stack />; }`,
      "app/routes/(tabs)/_layout.tsx": `${RN}export default function TabsLayout() { return <Tabs />; }`,
      "app/routes/(tabs)/feed.tsx": `${RN}export default function Feed() { return <Text>x</Text>; }`,
      "app/routes/[id].tsx": `${RN}const Detail = () => <Text>x</Text>;\nexport default Detail;`,
      "app/routes/hello+api.ts": "export function GET() { return Response.json({}); }",
      "app/routes/+html.tsx": `${RN}export default function HtmlRoot() { return <html><body /></html>; }`,
      "app/routes/(home)/_layout.tsx": `${RN}export default function HomeScreenLayout() { return <SafeAreaView><FlatList data={[]} renderItem={null} /><ScrollView /><Tabs.Navigator /></SafeAreaView>; }`,
      "app/components/Card.tsx": `${RN}export default function Card() { return <Text>x</Text>; }`,
    });
    expect([
      kindOf("Feed"),
      kindOf("Detail"),
      kindOf("RootLayout"),
      kindOf("TabsLayout"),
      kindOf("Card"),
    ]).toEqual(["screen", "screen", "component", "component", "component"]);
    expect([kindOf("HtmlRoot"), kindOf("HomeScreenLayout")]).toEqual(["component", "component"]);
  });

  it("reads no routes in an app without Expo Router", async () => {
    const { kindOf } = await app({
      "app/_layout.tsx": `${RN}export default function Layout() { return <View />; }`,
      "app/feed.tsx": `${RN}export default function Feed() { return <Text>x</Text>; }`,
    });
    expect(kindOf("Feed")).toBe("component");
  });

  speedIt(
    "reads thousands of screens quickly",
    async () => {
      const files: Record<string, string> = {};
      const lines: string[] = [];
      for (let i = 0; i < 2000; i++) {
        files[`src/s${i}.tsx`] = `${RN}export default function S${i}() { return <Text>x</Text>; }`;
        lines.push(
          `import S${i} from "./s${i}";`,
          `const r${i} = <Stack.Screen name="s${i}" component={S${i}} />;`,
        );
      }
      files["src/Nav.tsx"] = RN + lines.join("\n");
      const started = performance.now();
      const { screens } = await app(files);
      expect(screens.filter((s) => s.kind === "screen")).toHaveLength(2000);
      expect(performance.now() - started).toBeLessThan(10_000);
      // Writing thousands of files is slow on Windows, and isn't timed; the scan itself has the 10 seconds above.
    },
    30_000,
  );
});

describe("React Native screens, followed carefully", () => {
  const nav = (body: string, imports = "") =>
    `${RN}${imports}\nexport const Nav = () => <Stack.Navigator>${body}</Stack.Navigator>;`;

  it("ends a loop of files exporting each other, and follows re-exports by what they name", async () => {
    const { kindOf, screens } = await app({
      "src/a.tsx": `${RN}import X from "./b";\nexport default X;\nexport const N = () => <Stack.Screen name="x" component={X} />;`,
      "src/b.tsx": 'import X from "./a";\nexport default X;',
      "src/screens/index.ts": 'export { RealHome as Home } from "./real";\nexport * from "./more";',
      "src/screens/real.tsx": RN + plain("RealHome"),
      "src/screens/more.tsx": RN + plain("More"),
      "src/other/Home.tsx": RN + plain("Home"),
      "src/Nav.tsx": nav(
        '<Stack.Screen name="h" component={Home} /><Stack.Screen name="m" component={More} />',
        'import { Home, More } from "./screens";',
      ),
    });
    expect([kindOf("RealHome"), kindOf("More"), kindOf("Home")]).toEqual(["screen", "screen", "component"]);
    expect(screens.length).toBeGreaterThan(0);
  });

  it("never takes a package's component for the app's of the same name, and follows path aliases", async () => {
    const { kindOf } = await app({
      "src/view/ScrollView.tsx": `${RN}export function ScrollView() { return <View />; }`,
      "src/Signup.tsx": `import { ScrollView } from "react-native";\nexport const S = () => <Modal visible><ScrollView /></Modal>;`,
      "src/views/RoomView/index.tsx": RN + plain("RoomView"),
      "src/Nav.tsx": nav(
        '<Stack.Screen name="room" component={RoomView} />',
        'import { RoomView } from "~/views/RoomView";',
      ),
    });
    expect([kindOf("ScrollView"), kindOf("RoomView")]).toEqual(["component", "screen"]);
  });

  it("shows the screen a wrapper renders, through three higher-order components, loaders and children props", async () => {
    const { kindOf } = await app({
      "src/ObsEdit.tsx": RN + plain("ObsEdit"),
      "src/D.tsx": `${RN}function D() { return <Text>x</Text>; }\nconst A = withA(D);\nconst B = withB(A);\nconst C = withC(B);\nexport default C;`,
      "src/views.tsx": RN + plain("Home") + plain("Lazy") + plain("Kids"),
      "src/Nav.tsx": nav(
        [
          '<Stack.Screen name="e" component={FadeInObsEdit} />',
          '<Stack.Screen name="d" getComponent={() => require("./D").default} />',
          '<Stack.Screen name="h" getComponent={loadHome} />',
          '<Stack.Screen name="l" component={lazy(() => import("./Lazy"))} />',
          '<Stack.Screen name="k" children={() => <Kids />} />',
        ].join(""),
        'import { ObsEdit } from "./ObsEdit";\nimport { Home, Kids } from "./views";\nconst FadeInObsEdit = () => fadeIn(<ObsEdit />);\nfunction loadHome() { return Home; }',
      ),
      "src/Lazy.tsx": `${RN}export default function Lazy() { return <Text>x</Text>; }`,
    });
    expect(["ObsEdit", "D", "Home", "Lazy", "Kids", "FadeInObsEdit"].map(kindOf)).toEqual([
      "screen",
      "screen",
      "screen",
      "screen",
      "screen",
      "component",
    ]);
  });

  it("reads a screen from a namespace import, and doesn't count a component's own file as placing it", async () => {
    const { kindOf } = await app({
      "src/screens.tsx": RN + plain("Profile"),
      "src/Nav.tsx": nav(
        '<Stack.Screen name="p" component={Screens.Profile} />',
        'import * as Screens from "./screens";',
      ),
      "src/Page.tsx": `${RN}export function Wall() { return <SafeAreaView><ScrollView /><FlatList data={[]} renderItem={null} /></SafeAreaView>; }\nconst A = () => <Wall />;\nconst B = () => <Wall />;\nconst C = () => <Wall />;\nexport const D = () => <Wall />;`,
    });
    expect([kindOf("Profile"), kindOf("Wall")]).toEqual(["screen", "screen"]);
  });

  it("reads static configs held in variables, and every platform's file of a screen", async () => {
    const { kindOf } = await app({
      "src/views.tsx": RN + plain("Home"),
      "src/Help.android.tsx": `${RN}export default function AndroidHelp() { return <Text>x</Text>; }`,
      "src/Help.ios.tsx": `${RN}export default function IosHelp() { return <Text>x</Text>; }`,
      "src/Nav.tsx": `${RN}import { Home } from "./views";\nimport Help from "./Help";\nconst screens = { Home, Help };\nconst config = { screens };\nexport const Root = createNativeStackNavigator(config);`,
    });
    expect(["Home", "AndroidHelp", "IosHelp"].map(kindOf)).toEqual(["screen", "screen", "screen"]);
  });

  it("reads a component's own code for its signs, its props by any name, and navigators as containers", async () => {
    const { kindOf, screens } = await app({
      "src/Text.tsx": `${RN}export function Quote() { return <Text>{"<SafeAreaView><ScrollView/><FlatList/></SafeAreaView>"}</Text>; }`,
      "src/Outer.tsx": `${RN}export function Outer() { const Inner = () => <SafeAreaView><ScrollView /><FlatList data={[]} renderItem={null} /></SafeAreaView>; return <Text>x</Text>; }`,
      "src/Container.tsx": `${RN}export function Container(p) { return <SafeAreaView><ScrollView /><FlatList data={[]} renderItem={null} />{p.children}</SafeAreaView>; }`,
      "src/Tabs.tsx": `${RN}export function HomeTabs() { return <Tab.Navigator><Tab.Screen name="a" component={A} /></Tab.Navigator>; }\nfunction A() { return <Text>a</Text>; }\nexport const Root = () => <Stack.Screen name="tabs" component={HomeTabs} />;`,
      "src/List.tsx": `${RN}export const Entries = items.map(() => <Text>x</Text>);`,
    });
    expect(["Quote", "Outer", "Inner", "Container", "HomeTabs"].map(kindOf)).toEqual([
      "component",
      "component",
      "screen",
      "component",
      "component",
    ]);
    expect(screens.map((s) => s.name)).not.toContain("Entries");
  });

  it("doesn't take look-alike names for navigation: an app's <Screen>, createStackTrace, a LoadingModal", async () => {
    const { kindOf } = await app({
      "src/views.tsx": RN + plain("Thing") + plain("Detail") + plain("Spinner"),
      "src/A.tsx": `${RN}import { Thing, Detail, Spinner } from "./views";\nexport const A = () => <Screen>{items.map(() => <Thing />)}<LoadingModal visible><Spinner /></LoadingModal></Screen>;\nconst t = createStackTrace({ detail: Detail });`,
    });
    expect(["Thing", "Detail", "Spinner"].map(kindOf)).toEqual(["component", "component", "component"]);
  });

  it("takes a modal's content whole only when it's its one child, an element or an expression", async () => {
    const { kindOf } = await app({
      "src/views.tsx": RN + plain("Body") + plain("Other") + plain("Sheet"),
      "src/A.tsx": `${RN}import { Body, Other, Sheet } from "./views";\nexport const A = ({ on }) => <View><Modal><Body />{on && <Other />}</Modal><Modal>{<Sheet />}</Modal></View>;`,
    });
    expect(["Body", "Other", "Sheet"].map(kindOf)).toEqual(["component", "component", "screen"]);
  });

  it("counts placements by what each file's names reach, aliases included", async () => {
    const page = `${RN}export function Content() { return <SafeAreaView><ScrollView /><FlatList data={[]} renderItem={null} /></SafeAreaView>; }`;
    const placing = (n: string) =>
      `${RN}import { Content as Part } from "./a/Content";\nexport const ${n} = () => <Part />;`;
    const { screens } = await app({
      "src/a/Content.tsx": page,
      "src/b/Content.tsx": page,
      "src/x.tsx": placing("X"),
      "src/y.tsx": placing("Y"),
      "src/z.tsx": placing("Z"),
    });
    const kind = (file: string) => screens.find((s) => s.file === file)?.kind;
    expect([kind("src/a/Content.tsx"), kind("src/b/Content.tsx")]).toEqual(["component", "screen"]);
  });
});

describe("Expo Router's routes, read carefully", () => {
  const EXPO = { "package.json": '{ "dependencies": { "react-native": "0.76.0", "expo-router": "4.0.0" } }' };

  it("reads routes in app/ without a root layout, and every way a route exports its screen", async () => {
    const { kindOf } = await app({
      ...EXPO,
      "app/(tabs)/_layout.tsx": `${RN}export default function TabsLayout() { return <Tabs />; }`,
      "app/welcome.tsx": `${RN}export default function welcome() { return <Text>x</Text>; }`,
      "app/about.tsx": `${RN}export default () => <Shell title="About" />;`,
      "app/legacy.tsx": `${RN}export default class Legacy extends React.Component { render() { return <Text>x</Text>; } }`,
      "app/login.tsx": 'export { Login as default } from "../src/login";',
      "src/login.tsx": RN + plain("Login"),
      "src/Shell.tsx": RN + plain("Shell"),
      "src/x.tsx": `${RN}import { Shell } from "./Shell";\nexport const X = () => <Shell />;`,
    });
    expect(["Welcome", "About", "Legacy", "Login", "Shell", "TabsLayout"].map(kindOf)).toEqual([
      "screen",
      "screen",
      "screen",
      "screen",
      "component",
      "component",
    ]);
  });

  it("reads the routes folder the app hands ExpoRoot", async () => {
    const { kindOf } = await app({
      ...EXPO,
      "index.tsx":
        'import { ExpoRoot } from "expo-router";\nconst ctx = require.context("./app/routes");\nexport const App = () => <ExpoRoot context={ctx} />;',
      "app/routes/feed.tsx": `${RN}export default function Feed() { return <Text>x</Text>; }`,
      "app/components/Gallery.tsx": `${RN}export default function Gallery() { return <Text>x</Text>; }`,
    });
    expect([kindOf("Feed"), kindOf("Gallery")]).toEqual(["screen", "component"]);
  });
});

describe("React Native modules, second look", () => {
  it("follows an alias to a folder with an index beside its namesake, and never a package to the app's files", async () => {
    const { screens } = await app({
      "package.json": '{ "dependencies": { "react-native": "0.76.0", "@gorhom/bottom-sheet": "5.0.0" } }',
      "src/pages/Settings/index.ts": 'export { default } from "./Settings";',
      "src/pages/Settings/Settings.tsx": `${RN}export default function Settings() { return <Text>x</Text>; }`,
      "src/components/bottom-sheet.tsx": `${RN}export function Sheet() { return <SafeAreaView><ScrollView /><FlatList data={[]} renderItem={null} /></SafeAreaView>; }`,
      "src/Nav.tsx": `${RN}import Settings from "@pages/Settings";\nexport const Nav = () => <Stack.Screen name="s" component={Settings} />;`,
      ...Object.fromEntries(
        ["A", "B", "C"].map((n) => [
          `src/${n}.tsx`,
          `${RN}import { Sheet } from "@gorhom/bottom-sheet";\nexport const ${n} = () => <Sheet />;`,
        ]),
      ),
    });
    const kind = (name: string) => screens.find((s) => s.name === name)?.kind;
    expect([kind("Settings"), kind("Sheet")]).toEqual(["screen", "screen"]);
  });

  it("takes only ExpoRoot's context for the routes, and a file's platform variants as one place", async () => {
    const { kindOf } = await app({
      "package.json": '{ "dependencies": { "react-native": "0.76.0", "expo-router": "4.0.0" } }',
      "app/settings.tsx": `${RN}export default function Settings() { return <Text>x</Text>; }`,
      "src/icons.ts": 'const icons = require.context("../assets/icons", true);',
      // A long page in a screens folder, placed by one file's three platform variants: once, not reused.
      "src/screens/Feed.tsx": `${RN}export function Feed() {\n${"  const x = 1;\n".repeat(60)}  return <SafeAreaView><ScrollView /><FlatList data={[]} renderItem={null} /></SafeAreaView>;\n}`,
      "src/List.ios.tsx": `${RN}import { Feed } from "./screens/Feed";\nexport const List = () => <Feed />;`,
      "src/List.android.tsx": `${RN}import { Feed } from "./screens/Feed";\nexport const List = () => <Feed />;`,
      "src/List.web.tsx": `${RN}import { Feed } from "./screens/Feed";\nexport const List = () => <Feed />;`,
    });
    expect([kindOf("Settings"), kindOf("Feed")]).toEqual(["screen", "screen"]);
  });

  it("reads a wrapped anonymous default export, and a screen re-exported at the end of a long barrel", async () => {
    const stars = Array.from({ length: 80 }, (_, i) => `export * from "./m${i}";`).join("\n");
    const modules = Object.fromEntries(
      Array.from({ length: 80 }, (_, i) => [`src/barrel/m${i}.ts`, `export const v${i} = ${i};`]),
    );
    const { kindOf } = await app({
      ...modules,
      "src/barrel/index.ts": `${stars}\nexport * from "./target";`,
      "src/barrel/target.tsx": RN + plain("Target"),
      "src/Observed.tsx": `${RN}export default observer(() => <Container><Text>x</Text></Container>);`,
      "src/Container.tsx": `${RN}export function Container({ children }) { return <View>{children}</View>; }`,
      "src/Nav.tsx": `${RN}import Observed from "./Observed";\nimport { Target } from "./barrel";\nexport const Nav = () => <Stack.Navigator><Stack.Screen name="o" component={Observed} /><Stack.Screen name="t" component={Target} /></Stack.Navigator>;`,
    });
    expect([kindOf("Observed"), kindOf("Target"), kindOf("Container")]).toEqual([
      "screen",
      "screen",
      "component",
    ]);
  });
});
