const TEST_FOLDER =
  /(^|\/)([Tt]ests?|androidTest|testDebug|testRelease|screenshotTests|[Bb]enchmarks?|__tests__|__mocks__|e2e|E2E|UITests|[\w-]+Tests)\//;
const TEST_FILE = /(Tests?|Spec)\.(swift|kt)$|\.(test|spec)\.[jt]sx?$/;

/** Test, mock and benchmark sources, which are never screens and don't define the app's design. */
export const isTestPath = (rel: string) => TEST_FOLDER.test(rel) || TEST_FILE.test(rel);
