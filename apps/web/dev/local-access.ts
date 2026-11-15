import type { Plugin } from "vite";
import { localToken } from "../../../scripts/local-jwt.mjs";

/** Dev only: plays Cloudflare Access by adding a locally signed token to every request. */
export function localAccess(): Plugin {
  let token = "";
  let signedAt = 0;
  return {
    name: "budget-local-access",
    apply: "serve",
    configureServer(server) {
      // Registered directly (not in a returned hook) so it runs before the Worker plugin.
      server.middlewares.use(async (req, _res, next) => {
        if (!token || Date.now() - signedAt > 3_600_000) {
          token = await localToken({ email: "dev@localhost" });
          signedAt = Date.now();
        }
        req.headers["cf-access-jwt-assertion"] = token;
        next();
      });
    },
  };
}
