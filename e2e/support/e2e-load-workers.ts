import { readFileSync } from "node:fs";
import os from "node:os";

export type WorkerInputs = {
  cpuMax: string | null;
  memoryMax: string | null;
  cpus: number;
  override: string | undefined;
};

/**
 * The suite's worker count, or undefined for Playwright's default. Pure.
 * 8 workers on a 5-CPU, 5 GiB box reached the memory cap and stalled the test server (docs/e2e-load-design.md).
 */
export function workersFor(i: WorkerInputs): number | undefined {
  if (i.override !== undefined && /^[1-9]\d*$/.test(i.override)) return Number(i.override);
  const cap = Math.max(1, Math.floor(i.cpus / 2));
  const limits: number[] = [];
  const cpu = i.cpuMax?.trim().match(/^(\d+)\s+(\d+)$/);
  if (cpu && Number(cpu[2]) > 0) {
    limits.push(Math.max(1, Math.floor(Number(cpu[1]) / Number(cpu[2])) - 1));
  }
  const mem = i.memoryMax?.trim();
  if (mem && /^\d+$/.test(mem)) {
    limits.push(Math.max(1, Math.floor((Number(mem) - 2 * 1024 ** 3) / (512 * 1024 ** 2))));
  }
  if (limits.length === 0) return undefined;
  return Math.min(cap, ...limits);
}

function read(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** Reads the two cgroup files, the CPU count and E2E_WORKERS, then calls workersFor. */
export function suiteWorkers(): number | undefined {
  return workersFor({
    cpuMax: read("/sys/fs/cgroup/cpu.max"),
    memoryMax: read("/sys/fs/cgroup/memory.max"),
    cpus: os.availableParallelism(),
    override: process.env.E2E_WORKERS,
  });
}
