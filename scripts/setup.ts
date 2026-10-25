import { existsSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
if (!existsSync(".env")) {
  const password = randomBytes(24).toString("hex");
  writeFileSync(
    ".env",
    `POSTGRES_PASSWORD=${password}\nDATABASE_URL=postgres://kousou:${password}@127.0.0.1:55432/kousou\nSESSION_PEPPER=${randomBytes(32).toString("hex")}\nPORT=3000\nHOST=0.0.0.0\n`,
    { mode: 0o600 },
  );
  console.log(
    "Created local .env with random credentials. Values are not displayed.",
  );
}
execFileSync("docker", ["compose", "up", "-d", "--wait", "db"], {
  stdio: "inherit",
});
execFileSync("pnpm", ["db:migrate"], { stdio: "inherit" });
