import { execFile } from "node:child_process";
import { relative } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const VITEST_BIN = "node_modules/.bin/vitest";
const LIST_TIMEOUT_MS = 20_000;

/** Test files the default config (the one `npm test` uses) would run, relative to the project root. */
const listDefaultTestFiles = async (): Promise<string[]> => {
  // --filesOnly lists paths without importing the files, so live tests never execute here.
  const { stdout } = await promisify(execFile)(VITEST_BIN, ["list", "--filesOnly", "--json"]);
  const listed = JSON.parse(stdout) as Array<{ file: string }>;
  return listed.map(({ file }) => relative(process.cwd(), file));
};

describe("npm test", () => {
  it(
    "does not run anything in tests/live/",
    async () => {
      const testFiles = await listDefaultTestFiles();

      expect(testFiles).toContain("tests/classifyAll.test.ts");
      expect(testFiles.filter((file) => file.startsWith("tests/live/"))).toEqual([]);
    },
    LIST_TIMEOUT_MS,
  );
});
