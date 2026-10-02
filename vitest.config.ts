import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// The "@/" alias of tsconfig.json, which Next.js resolves for the app and Vitest does not by itself.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
});
