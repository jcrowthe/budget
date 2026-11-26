import { localToken } from "../../scripts/local-jwt.mjs";

/**
 * A signed-in user of its own (`zz-test-<label>-<rand>@localhost`), for specs whose subject is per-user
 * state (EXF-472 settings). Pass `storageState` to `test.use` or `browser.newContext`. Mirrors global-setup.ts.
 */
export async function ownUser(label: string) {
  const email = `zz-test-${label}-${Math.random().toString(36).slice(2, 8)}@localhost`;
  const token = await localToken({ email });
  const storageState = {
    cookies: [
      {
        name: "CF_Authorization",
        value: token,
        domain: "localhost",
        path: "/",
        expires: -1,
        httpOnly: true,
        secure: false,
        sameSite: "Lax" as const,
      },
    ],
    origins: [],
  };
  return { email, token, storageState };
}
