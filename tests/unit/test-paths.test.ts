import { expect, it } from "vitest";
import { isTestPath } from "../../src/scan/test-paths.js";

it.each([
  "Tests/AppTests.swift",
  "AppUITests/LoginTests.swift",
  "AppTests/Helpers/Fixture.swift",
  "Sources/LoginSpec.swift",
  "Benchmarks/Scroll.swift",
])("treats %s as a test", (rel) => expect(isTestPath(rel)).toBe(true));

it.each([
  "Sources/HomeView.swift",
  "Sources/Testimonials/QuoteView.swift",
  "App/Contest.swift",
  "Contests/Board.swift",
])("treats %s as app code", (rel) => expect(isTestPath(rel)).toBe(false));
