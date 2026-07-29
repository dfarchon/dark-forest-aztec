// Untracked local dev config: extends the repo config to allow access through
// the tailscale serve proxy (https://homelab.tail1eea19.ts.net:8443 -> :5173).
// Run with: vite --config vite.config.local.mts   — never commit this file.
import base from "./vite.config.ts";

export default {
  ...base,
  server: {
    ...(base as { server?: object }).server,
    allowedHosts: ["homelab.tail1eea19.ts.net"],
  },
};
