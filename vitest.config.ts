import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
export default defineConfig({
  resolve: { alias: {
    "@tarot/contracts": resolve("packages/contracts/src/index.ts"),
    "@tarot/domain": resolve("packages/domain/src/index.ts"),
    "@tarot/tarot": resolve("packages/tarot/src/index.ts"),
    "@tarot/adapters": resolve("packages/adapters/src/index.ts"),
    "@tarot/config": resolve("packages/config/src/index.ts"),
    "@tarot/db": resolve("packages/db/src/index.ts")
  } },
  test: { include: ["tests/**/*.test.ts"] }
});
