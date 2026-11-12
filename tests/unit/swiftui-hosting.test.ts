import { describe, expect, it } from "vitest";
import { hostedViews } from "../../src/frameworks/swiftui-hosting.js";
import { scanRepo } from "../../src/scan/index.js";
import { speedIt } from "../helpers/speed.js";
import { tempDir } from "../helpers/temp.js";

/** A view laid out like a page (navigation, a list, a title): a screen on its own, unless the app shows it as part of
 * another page. */
const view = (name: string) =>
  `import SwiftUI\nstruct ${name}: View { var body: some View { NavigationStack { List { Text(t) }.navigationTitle(t) } } }`;

/** Each view's kind, with `host` written in a UIKit-only file. */
async function kindsHostedBy(host: string, views = ["Details"]) {
  const files = Object.fromEntries(views.map((v) => [`App/${v}.swift`, view(v)]));
  const root = await tempDir({ ...files, "App/Host.swift": `import UIKit\n${host}` });
  const screens = (await scanRepo(root)).frameworks[0]?.screens ?? [];
  return Object.fromEntries(screens.map((s) => [s.name, s.kind]));
}

describe("views hosted from UIKit", () => {
  it("treats a hosted view the app presents or pushes as a screen, from a file that only imports UIKit", async () => {
    for (const host of [
      "final class C { func open() { present(UIHostingController(rootView: Details()), animated: true) } }",
      "final class C { func open() { let h = UIHostingController(rootView: Details())\n nav.pushViewController(h, animated: true) } }",
    ]) {
      expect((await kindsHostedBy(host)).Details).toBe("screen");
    }
  });

  it("hosts the view a variable was last built as, when one name is reused for several", async () => {
    const files = {
      "App/First.swift": "import SwiftUI\nstruct First: View { var body: some View { Text(t) } }",
      "App/Second.swift": "import SwiftUI\nstruct Second: View { var body: some View { Text(t) } }",
      "App/Host.swift": [
        "import UIKit",
        "final class C {",
        "  func a() { let page = First()\n present(UIHostingController(rootView: page), animated: true) }",
        "  func b() { let page = Second()\n present(UIHostingController(rootView: page), animated: true) }",
        "}",
      ].join("\n"),
    };
    const screens = (await scanRepo(await tempDir(files))).frameworks[0]?.screens ?? [];
    expect(Object.fromEntries(screens.map((s) => [s.name, s.kind]))).toMatchObject({
      First: "screen",
      Second: "screen",
    });
  });

  it("treats a view built first and hosted later as a screen", async () => {
    const host =
      "final class C { func open() { let page = Details()\n present(UIHostingController(rootView: page), animated: true) } }";
    expect((await kindsHostedBy(host)).Details).toBe("screen");
  });

  it("treats a hosting subclass's root view, and a root wrapped in a provider, as a screen", async () => {
    for (const host of [
      "final class PageController: UIHostingController<Details> { init() { super.init(rootView: Details()) } }",
      "let h = UIHostingController(rootView:\n  StoreProvider(store: s) {\n    Details()\n  })",
    ]) {
      expect((await kindsHostedBy(host)).Details).toBe("screen");
    }
  });

  it("treats a hosted view filling a controller as its only child as a screen", async () => {
    const host = [
      "final class SettingsController: UIViewController {",
      "  let hosting = UIHostingController(rootView: Details())",
      "  override func viewDidLoad() { addChild(hosting)\n view.addSubview(hosting.view) }",
      "}",
    ].join("\n");
    expect((await kindsHostedBy(host)).Details).toBe("screen");
  });

  it("treats a hosted view inside a UIKit view or cell, or one of several children, as a component", async () => {
    const inView = "final class Banner: UIView { let hosting = UIHostingController(rootView: Details()) }";
    const inCell =
      "final class Row: UITableViewCell { let hosting = UIHostingController(rootView: Details()) }";
    const sections = [
      "final class Checkout: UIViewController {",
      "  let summary = UIHostingController(rootView: Details())",
      "  let shipping = UIHostingController(rootView: Other())",
      "  override func viewDidLoad() { addChild(summary)\n addChild(shipping) }",
      "}",
    ].join("\n");
    expect((await kindsHostedBy(inView)).Details).toBe("component");
    expect((await kindsHostedBy(inCell)).Details).toBe("component");
    expect(await kindsHostedBy(sections, ["Details", "Other"])).toMatchObject({
      Details: "component",
      Other: "component",
    });
  });

  it("treats views kept in typed properties as sections when a controller has several children", async () => {
    const host = [
      "final class Checkout: UIViewController {",
      "  let summary: UIHostingController<Details> = UIHostingController(rootView: Details())",
      "  let shipping: UIHostingController<Other> = UIHostingController(rootView: Other())",
      "  override func viewDidLoad() { addChild(summary)\n addChild(shipping) }",
      "}",
    ].join("\n");
    expect(await kindsHostedBy(host, ["Details", "Other"])).toMatchObject({
      Details: "component",
      Other: "component",
    });
  });

  it("treats a view hosted by a view, NSHostingView, as a component", async () => {
    expect((await kindsHostedBy("let v = NSHostingView(rootView: Details())")).Details).toBe("component");
  });

  it("reads a property typed with the hosted view", async () => {
    const host =
      "final class C: UIViewController { var page: UIHostingController<Details>\n func open() { show(page, sender: nil) } }";
    expect((await kindsHostedBy(host)).Details).toBe("screen");
  });

  it("matches a child added through self, or made in place, and one added in an extension", async () => {
    const twoChildren = (adding: string) =>
      [
        "final class Checkout: UIViewController {",
        "  let summary = UIHostingController(rootView: Details())",
        "  let shipping = UIHostingController(rootView: Other())",
        "}",
        adding,
      ].join("\n");
    for (const host of [
      twoChildren("extension Checkout { func setup() { addChild(self.summary)\n addChild(self.shipping) } }"),
      twoChildren("private extension Checkout { func setup() { addChild(summary)\n addChild(shipping) } }"),
    ]) {
      expect(await kindsHostedBy(host, ["Details", "Other"])).toMatchObject({
        Details: "component",
        Other: "component",
      });
    }
    const inPlace = [
      "final class Checkout: UIViewController {",
      "  func setup() { addChild(UIHostingController(rootView: Details()))\n addChild(UIHostingController(rootView: Other())) }",
      "}",
    ].join("\n");
    expect(await kindsHostedBy(inPlace, ["Details", "Other"])).toMatchObject({
      Details: "component",
      Other: "component",
    });
  });

  it("knows an extension of a UIKit view is that view, and a class method isn't a type", async () => {
    const extended =
      "final class Banner: UIView {}\nextension Banner { func setup() { let h = UIHostingController(rootView: Details()) } }";
    const classMethod =
      "final class Banner: UIView {\n  class func make() -> UIView { let h = UIHostingController(rootView: Details())\n return h.view }\n}";
    expect((await kindsHostedBy(extended)).Details).toBe("component");
    expect((await kindsHostedBy(classMethod)).Details).toBe("component");
  });

  it("finds the page inside the app's own wrapper view, and ignores a cast to a hosting type", async () => {
    const files = {
      "App/Shell.swift":
        "import SwiftUI\nstruct Shell<Content: View>: View { let content: Content\n var body: some View { content } }",
      "App/Details.swift": "import SwiftUI\nstruct Details: View { var body: some View { Text(t) } }",
      "App/Host.swift":
        "import UIKit\nfinal class C { func open() { present(UIHostingController(rootView: Shell { Details() }), animated: true) } }",
      "App/Cast.swift":
        "import UIKit\nfinal class Cell: UITableViewCell { func f(c: UIViewController) { _ = c as? UIHostingController<Other> } }",
      "App/Other.swift": view("Other"),
    };
    const screens = (await scanRepo(await tempDir(files))).frameworks[0]?.screens ?? [];
    const kinds = Object.fromEntries(screens.map((s) => [s.name, s.kind]));
    expect(kinds).toMatchObject({ Details: "screen", Other: "screen" });
  });

  it("matches a local controller only within its own function, counting children across the type", async () => {
    const host = [
      "final class Prefs: NSViewController {",
      "  func show(_ c: NSViewController) { addChild(c) }",
      "  func help() { let controller = NSHostingController(rootView: Details())\n addChild(controller) }",
      "  func add() { let controller = NSHostingController(rootView: Other())\n presentAsSheet(controller) }",
      "}",
    ].join("\n");
    expect(await kindsHostedBy(host, ["Details", "Other"])).toMatchObject({
      Details: "component",
      Other: "screen",
    });
  });

  it("counts children a type adds in an extension in another file", async () => {
    const files = {
      "App/Details.swift": view("Details"),
      "App/Other.swift": view("Other"),
      "App/Checkout.swift": [
        "import UIKit",
        "final class Checkout: UIViewController {",
        "  let summary = UIHostingController(rootView: Details())",
        "  let shipping = UIHostingController(rootView: Other())",
        "}",
      ].join("\n"),
      "App/Checkout+Layout.swift":
        "import UIKit\nextension Checkout { func setup() { addChild(summary)\n addChild(shipping) } }",
    };
    const screens = (await scanRepo(await tempDir(files))).frameworks[0]?.screens ?? [];
    expect(Object.fromEntries(screens.map((s) => [s.name, s.kind]))).toMatchObject({
      Details: "component",
      Other: "component",
    });
  });

  it("keeps a controller built in a property's closure in that property, and follows superclasses", async () => {
    const lazy = [
      "final class Checkout: UIViewController {",
      "  lazy var summary: UIHostingController<Details> = { let c = UIHostingController(rootView: Details())\n return c }()",
      "  lazy var shipping: UIHostingController<Other> = { let c = UIHostingController(rootView: Other())\n return c }()",
      "  override func viewDidLoad() { addChild(summary)\n addChild(shipping) }",
      "}",
    ].join("\n");
    expect(await kindsHostedBy(lazy, ["Details", "Other"])).toMatchObject({
      Details: "component",
      Other: "component",
    });
    const subclass =
      "class Base: UIView {}\nfinal class Banner: Base { let h = UIHostingController(rootView: Details()) }";
    expect((await kindsHostedBy(subclass)).Details).toBe("component");
  });
});

/** Seconds to read `code` as one file hosting `Details`. */
function secondsToRead(code: string): number {
  const source = { rel: "Host.swift", text: code, code, lines: [], swiftUI: false };
  const started = performance.now();
  hostedViews([source], new Set(["Details"]));
  return (performance.now() - started) / 1000;
}

describe("hosting on hostile input", () => {
  // Four times the input should take about four times as long; sixteen times means the reading is quadratic.
  // The best of three runs at each size, so a pause on a busy machine doesn't count.
  const growth = (make: (n: number) => string) => {
    const best = (code: string) => Math.min(...[0, 1, 2].map(() => secondsToRead(code)));
    secondsToRead(make(500));
    const small = best(make(2_000));
    const large = best(make(8_000));
    return large / Math.max(small, 0.002);
  };

  speedIt("grows linearly with long runs of spaces in a class header", () => {
    expect(growth((n) => `class A${" ".repeat(n * 16)}`)).toBeLessThan(8);
  });

  speedIt(
    "grows linearly with many hosting sites reusing one name",
    () => {
      // Large enough for a lookup that rereads every earlier assignment to stand out from the reading itself.
      expect(growth((n) => "let page = Details()\n_ = H(rootView: page)\n".repeat(n * 8))).toBeLessThan(8);
    },
    60_000,
  );

  speedIt("grows linearly with deeply nested closures, each assigned and hosting a view", () => {
    const level = "x = { let h = UIHostingController(rootView: Details())\n";
    expect(growth((n) => `var a = { ${level.repeat(n)}${"}()".repeat(n)} }()`)).toBeLessThan(8);
  });

  speedIt("grows linearly with deeply nested blocks each adding its own controller", () => {
    const block = "do { let h = UIHostingController(rootView: Details())\n addChild(h)\n";
    const nested = (n: number) =>
      `final class C: UIViewController {\n func f() {\n${block.repeat(n)}${"}".repeat(n)} }\n}`;
    expect(growth(nested)).toBeLessThan(8);
  });
});
