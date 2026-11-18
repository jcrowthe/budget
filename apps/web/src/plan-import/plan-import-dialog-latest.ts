/** Each next() aborts the previous controller and returns a sequence number; isLatest(seq) is true only for the last. */
export function latestOnly(): {
  next(): { seq: number; signal: AbortSignal };
  isLatest(seq: number): boolean;
} {
  let seq = 0;
  let controller: AbortController | null = null;
  return {
    next() {
      controller?.abort();
      controller = new AbortController();
      seq += 1;
      return { seq, signal: controller.signal };
    },
    isLatest: (s) => s === seq,
  };
}
