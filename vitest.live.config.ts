import { defineConfig } from "vitest/config";

// Opt-in suite against the real Anthropic API, run with `npm run test:live`.
export default defineConfig({
  test: {
    include: ["tests/live/**/*.test.ts"],
  },
});
