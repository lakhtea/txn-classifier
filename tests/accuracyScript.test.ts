import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

const ACCURACY_SCRIPT = "scripts/accuracy.ts";
const TSX_BIN = "node_modules/.bin/tsx";
const SCRIPT_TIMEOUT_MS = 20_000;

interface ScriptRun {
  exitCode: number | null;
  output: string;
}

const runScript = async (args: string[], env: NodeJS.ProcessEnv): Promise<ScriptRun> =>
  new Promise((resolve, reject) => {
    const child = spawn(TSX_BIN, [ACCURACY_SCRIPT, ...args], { env });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ exitCode, output }));
  });

/**
 * A local stand-in for the Anthropic API that only counts requests.
 * The child points the SDK at it, so even a misbehaving script never reaches the network.
 * It rejects every request as unauthenticated, which the SDK does not retry, so such a script fails fast.
 */
const startRequestCounter = async (): Promise<{ server: Server; requestCount: () => number }> => {
  let requestCount = 0;
  const server = createServer((_request, response) => {
    requestCount += 1;
    response
      .writeHead(401, { "content-type": "application/json" })
      .end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "stand-in" } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, requestCount: () => requestCount };
};

let apiStandIn: Server | undefined;

afterEach(async () => {
  await new Promise<void>((resolve) => (apiStandIn ? apiStandIn.close(() => resolve()) : resolve()));
  apiStandIn = undefined;
});

describe("npm run accuracy", () => {
  it(
    "exits with code 1 and points at .env when ANTHROPIC_API_KEY is empty, before any API request",
    async () => {
      expect(existsSync(ACCURACY_SCRIPT), `${ACCURACY_SCRIPT} must exist`).toBe(true);
      const { server, requestCount } = await startRequestCounter();
      apiStandIn = server;
      const { port } = server.address() as AddressInfo;

      const { exitCode, output } = await runScript([], {
        ...process.env,
        ANTHROPIC_API_KEY: "",
        ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
      });

      expect(exitCode, output).toBe(1);
      expect(output).toContain(".env");
      expect(requestCount()).toBe(0);
    },
    SCRIPT_TIMEOUT_MS,
  );

  it(
    "exits with code 1 and names the path when the golden file cannot be read, before any API request",
    async () => {
      const missingGoldenPath = "data/does-not-exist.csv";
      const { server, requestCount } = await startRequestCounter();
      apiStandIn = server;
      const { port } = server.address() as AddressInfo;

      const { exitCode, output } = await runScript([missingGoldenPath], {
        ...process.env,
        ANTHROPIC_API_KEY: "sk-ant-placeholder-not-a-real-key",
        ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
      });

      expect(exitCode, output).toBe(1);
      expect(output).toContain(missingGoldenPath);
      expect(requestCount()).toBe(0);
    },
    SCRIPT_TIMEOUT_MS,
  );
});
