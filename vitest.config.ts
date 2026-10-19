import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Les tests d'intégration ont besoin de la base : npm run test:integration.
    exclude: [...configDefaults.exclude, "src/**/*.integration.test.ts"],
  },
});
