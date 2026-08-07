import { defineConfig } from "vitest/config";
import path from "node:path";

const root = import.meta.dirname;

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // Policy tests need a live database and are opt-in; see tests/policies.
    exclude: ["node_modules/**", ".next/**", "tests/policies/**"],
  },
  resolve: {
    alias: { "@": path.resolve(root, "./src") },
  },
});
