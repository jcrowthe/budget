// Prefixes every line of stdin with the time it arrived (HH:MM:SS.mmm, UTC) for scripts/e2e-load.sh.
import { createInterface } from "node:readline";

for await (const line of createInterface({ input: process.stdin }))
  process.stdout.write(`${new Date().toISOString().slice(11, 23)} ${line}\n`);
