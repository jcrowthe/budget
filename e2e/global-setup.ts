import { mkdirSync, writeFileSync } from "node:fs";
import { localToken } from "../scripts/local-jwt.mjs";

export default async function globalSetup() {
  mkdirSync(".e2e-state", { recursive: true });
  const token = await localToken({ email: "e2e@localhost" });
  writeFileSync(
    ".e2e-state/auth.json",
    JSON.stringify({
      cookies: [
        {
          name: "CF_Authorization",
          value: token,
          domain: "localhost",
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: false,
          sameSite: "Lax",
        },
      ],
      origins: [],
    }),
    { mode: 0o600 },
  );
}
