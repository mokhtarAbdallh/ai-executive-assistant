import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { conditions: ["source"] },
  test: {
    environment: "node",
    // Presigning S3 URLs is local signing but needs *some* credentials. Fixed fake ones keep
    // tests off the developer's real ~/.aws profile and make CI (no credentials) pass.
    env: {
      AWS_ACCESS_KEY_ID: "test",
      AWS_SECRET_ACCESS_KEY: "test",
      AWS_REGION: "eu-central-1",
    },
  },
});
