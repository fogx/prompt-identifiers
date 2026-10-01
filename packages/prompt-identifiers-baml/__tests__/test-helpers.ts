/**
 * Run `body` against a clock that moves one tick per read, so a span the code under test times
 * with two reads comes out as one tick. `advance` adds ticks nothing read, standing in for the
 * model's latency. The clock starts at 100 so an absolute reading cannot pass for an elapsed time.
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

/** Ticks a charged read costs, large enough that a duration missing them cannot read as one. */
export const CHARGED_TICKS = 10;

/**
 * Give `part` a `key` that costs `CHARGED_TICKS` the first time the code under test reads it, so
 * a duration carries them only when its span covers the read. Without this a stubbed clock
 * counts reads rather than work, and a span moved below the work it times keeps both its reads.
 */
export function chargingRead<T extends object>(
  part: T,
  key: string,
  value: string,
  advance: (ticks: number) => void
): T {
  let charged = false;
  Object.defineProperty(part, key, {
    get() {
      if (!charged) {
        charged = true;
        advance(CHARGED_TICKS);
      }
      return value;
    },
    enumerable: true,
  });
  return part;
}
