/**
 * Shared test helpers for the BAML wrapper tests.
 */

/**
 * Run `body` against a clock that advances one tick per read, so a duration the code under
 * test computes from two reads is exactly the number of reads between them. `advance` adds
 * ticks nothing read, which is where the model's latency goes. The clock starts above zero so
 * a reading of the clock itself cannot pass for an elapsed time, and owning the try means the
 * real clock is restored even when `body` throws.
 */
export async function withStubbedClock<T>(
  body: (advance: (ticks: number) => void) => Promise<T>
): Promise<T> {
  let tick = 100;
  const realNow = performance.now;
  performance.now = () => {
    const now = tick;
    tick += 1;
    return now;
  };
  try {
    return await body((ticks) => {
      tick += ticks;
    });
  } finally {
    performance.now = realNow;
  }
}
