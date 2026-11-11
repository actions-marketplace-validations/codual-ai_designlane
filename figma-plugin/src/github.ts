/** Reads tokens.json from a GitHub repo, with GitHub's refusals put in words a designer can act on. */

import type { Connection } from "./connection.js";
import type { RepoSource } from "./messages.js";

const GITHUB_API = "https://api.github.com";
/** Asks for a file's contents as they are, rather than wrapped in JSON. */
const RAW_CONTENTS = "application/vnd.github.raw+json";
const API_VERSION = "2022-11-28";

/** The file `connection` points at; its settings are checked by `checkConnection` first. */
export async function fetchTokensFile({ repo, branch, path, token }: Connection): Promise<string> {
  const file = path.split("/").map(encodeURIComponent).join("/");
  const url = `${GITHUB_API}/repos/${repo}/contents/${file}?ref=${encodeURIComponent(branch)}`;
  let response: FetchResponse;
  try {
    response = await fetch(url, {
      headers: {
        Accept: RAW_CONTENTS,
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": API_VERSION,
      },
    });
  } catch {
    throw new Error("Couldn't reach GitHub. Check your internet connection, then try again.");
  }
  if (response.ok) return response.text();
  throw new Error(refusalMessage(response, { repo, branch, path }));
}

function refusalMessage(response: FetchResponse, { repo, branch, path }: RepoSource): string {
  if (response.status === 401) {
    return "GitHub didn't accept the token: it may be mistyped or expired. Check it, or make a new one, then connect again.";
  }
  if (response.status === 403 && header(response, "x-ratelimit-remaining") === "0") {
    return "GitHub is limiting requests for now. Try again in a few minutes.";
  }
  if (response.status === 403) {
    return `The token can't read ${repo}. Give it read access to this repo's contents.`;
  }
  if (response.status === 404) {
    return `Couldn't find ${path} on ${branch} in ${repo}. Check the names and that the token can read the repo; if CI hasn't written the file yet, it will on the next push.`;
  }
  return `GitHub answered ${response.status} ${response.statusText}. Try again in a moment.`;
}

/** A response header, whatever case GitHub gave its name in. */
const header = (response: FetchResponse, name: string) =>
  Object.entries(response.headersObject).find(([key]) => key.toLowerCase() === name)?.[1];
