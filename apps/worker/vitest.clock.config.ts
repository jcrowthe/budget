import { clockAheadDate, workerProject } from "./vitest.config";

// The clock-ahead guard (EXF-977): the worker suite again, with the clock a month ahead. WORKER_CLOCK overrides.
export default workerProject("worker-clock", process.env.WORKER_CLOCK || clockAheadDate());
