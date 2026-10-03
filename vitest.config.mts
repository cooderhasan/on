import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // "server-only" Next dışında hata fırlatır; testlerde boş modül
      "server-only": fileURLToPath(new URL("./tests/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    globalSetup: ["./tests/global-setup.ts"],
    setupFiles: ["./tests/setup.ts"],
    // Testler aynı veritabanını paylaşır → dosyalar sırayla
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
