import { defineConfig } from "vite";

// Relative base so the build works at https://<user>.github.io/<repo>/ without configuration.
export default defineConfig({
  base: "./",
});
