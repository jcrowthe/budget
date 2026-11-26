/**
 * Move `Date` so that "now" is `iso` (time keeps running in real time, so successive writes keep distinct
 * timestamps; fake timers would tick in 20 ms steps and tie them). Idempotent: a later call re-bases on the real clock.
 * Used by the clock-ahead guard in setup.ts (EXF-977), and by `pinClock`.
 */
const RealDate = (globalThis as { __RealDate?: DateConstructor }).__RealDate ?? Date;
(globalThis as { __RealDate?: DateConstructor }).__RealDate = RealDate;

export function setClock(iso: string): void {
  const offset = new RealDate(iso).getTime() - RealDate.now();
  class ShiftedDate extends RealDate {
    constructor(...args: unknown[]) {
      // biome-ignore lint/suspicious/noExplicitAny: forwarding the overloaded Date constructor
      super(...((args.length === 0 ? [RealDate.now() + offset] : args) as [any]));
    }
    static override now(): number {
      return RealDate.now() + offset;
    }
  }
  globalThis.Date = ShiftedDate as DateConstructor;
}

/**
 * Pin the clock at `iso` for this test file. For a file whose fixtures are a fixed month (`NOV`, `TODAY`) and
 * whose code under test reads the real clock: it takes the file out of the clock-ahead guard on purpose, so it
 * must not depend on the calendar month. Call at the top level.
 */
export const pinClock = setClock;
