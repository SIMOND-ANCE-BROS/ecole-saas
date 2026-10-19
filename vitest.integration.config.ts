import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

// En local, les URL de connexion viennent de .env ; en CI, de l'environnement
// (loadEnvFile n'écrase pas une variable déjà définie).
if (existsSync(".env")) process.loadEnvFile(".env");

/** Tests d'intégration : exécutés contre la vraie base PostgreSQL, migrations appliquées. */
export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    // Une seule base partagée : pas de fichiers en parallèle.
    fileParallelism: false,
  },
});
