import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/main.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  noExternal: [/^@dawwen\//],
  // Every other bare import stays external, including deps of @dawwen/* (AWS SDK, Prisma):
  // bundling CommonJS into ESM fails at runtime ("Dynamic require of ... is not supported").
  // The image installs them hoisted into /app/node_modules (Dockerfile: --shamefully-hoist).
  external: [/^(?![./]|@dawwen\/)/],
  esbuildOptions(options) {
    options.conditions = ["source"];
  },
});
