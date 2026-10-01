import { describe, expect, test } from "vitest";

import { withStubbedClock } from "./test-helpers";

describe("withStubbedClock", () => {
  test("starts above zero and costs one tick per read, plus whatever advance adds", async () => {
    const [first, second] = await withStubbedClock(async (advance) => {
      const before = performance.now();
      advance(40);
      return [before, performance.now()];
    });

    // Above zero, so an absolute reading of the clock cannot pass for an elapsed time
    expect(first).toBeGreaterThan(0);
    // One tick for the first read, and the 40 the latency added without reading
    expect(second - first).toBe(41);
  });

  test("puts the real clock back when the body throws", async () => {
    const real = performance.now;

    await expect(
      withStubbedClock(async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");

    expect(performance.now).toBe(real);
  });
});
