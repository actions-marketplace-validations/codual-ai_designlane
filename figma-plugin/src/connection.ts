/** Where the plugin reads tokens.json from: a GitHub repo, and the token that reads it, kept on this computer only. */

import { z } from "zod";
import { RepoSource } from "./messages.js";

const STORAGE_KEY = "connection";
/** `owner/name`: letters, digits, `.`, `_` and `-` on each side of the slash. */
const REPO_NAME = /^[\w.-]+\/[\w.-]+$/;

export const Connection = RepoSource.extend({ token: z.string() });
export type Connection = z.infer<typeof Connection>;

/** `connection`, once each setting is one GitHub can read; otherwise what to fix, in words a designer can act on. */
export function checkConnection(connection: Connection): Connection {
  const { repo, branch, path, token } = connection;
  if (!REPO_NAME.test(repo) || repo.split("/").some(isDotPart)) {
    throw new Error(`"${repo}" isn't a repo name. Write it as owner/name, for example octocat/my-app.`);
  }
  if (branch === "") throw new Error("Enter the branch to read, for example main.");
  if (!path.split("/").every((part) => part !== "" && !isDotPart(part))) {
    throw new Error(`"${path}" isn't a file's path in the repo. Write it like designmap/tokens.json.`);
  }
  if (token === "") throw new Error("Paste a GitHub token that can read this repo.");
  return connection;
}

/** `.` or `..`, which would step outside the repo's files. */
const isDotPart = (part: string) => part === "." || part === "..";

/** The connection saved on this computer, or undefined before one is made. */
export async function savedConnection(): Promise<Connection | undefined> {
  return Connection.safeParse(await figma.clientStorage.getAsync(STORAGE_KEY)).data;
}

export const saveConnection = (connection: Connection) =>
  figma.clientStorage.setAsync(STORAGE_KEY, connection);

export const forgetConnection = () => figma.clientStorage.deleteAsync(STORAGE_KEY);
