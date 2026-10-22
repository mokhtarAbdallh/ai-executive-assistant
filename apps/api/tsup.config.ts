import { defineConfig } from "tsup";

// Workspace packages are bundled from TS source (`source` condition); npm deps stay external
// and are installed in the image with `pnpm deploy --prod`.
export default defineConfig({
  entry: ["src/main.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  noExternal: [/^@dawwen\//],
  esbuildOptions(options) {
    options.conditions = ["source"];
  },
});
