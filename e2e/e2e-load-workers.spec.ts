import { expect, test } from "./fixtures";
import { workersFor } from "./support/e2e-load-workers";

const base = { cpuMax: null, memoryMax: null, cpus: 16, override: undefined };

test("a 5-CPU quota gives 4 workers", () => {
  expect(workersFor({ ...base, cpuMax: "500000 100000\n", memoryMax: "max\n" })).toBe(4);
});

test("no quota and no memory limit leaves Playwright's default", () => {
  expect(workersFor({ ...base, cpuMax: "max 100000" })).toBeUndefined();
  expect(workersFor(base)).toBeUndefined();
});

test("a 1.5-CPU quota gives 1 worker", () => {
  expect(workersFor({ ...base, cpuMax: "150000 100000" })).toBe(1);
});

test("a 16-CPU quota on 16 CPUs stays at the default cap of 8", () => {
  expect(workersFor({ ...base, cpuMax: "1600000 100000" })).toBe(8);
});

test("a 5 GiB memory limit alone gives 5 workers", () => {
  expect(workersFor({ ...base, cpuMax: "max 100000", memoryMax: "5249171456\n" })).toBe(5);
});

test("E2E_WORKERS=2 overrides the quota", () => {
  expect(workersFor({ ...base, cpuMax: "500000 100000", override: "2" })).toBe(2);
});

test("E2E_WORKERS=0 or abc is ignored", () => {
  for (const override of ["0", "abc"]) {
    expect(workersFor({ ...base, cpuMax: "500000 100000", override })).toBe(4);
  }
});
