import { defineConfig } from "@trigger.dev/sdk/v3";

export default defineConfig({
  project: "proj_fvctbaymzkkknzkcjtak",
  dirs: ["./trigger"],
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 2,
      factor: 1.4,
      minTimeoutInMs: 1_000,
      maxTimeoutInMs: 10_000,
      randomize: true,
    },
  },
});
