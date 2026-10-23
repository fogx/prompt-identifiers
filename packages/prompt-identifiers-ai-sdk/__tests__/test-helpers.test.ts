import { describe, expect, test } from "vitest";

import { CHARGED_TICKS, chargingRead, countRegExpBuilds, withStubbedClock } from "./test-helpers";

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

describe("countRegExpBuilds", () => {
  test("counts the constructions and puts the real RegExp back", async () => {
    const real = globalThis.RegExp;

    const built = await countRegExpBuilds(async () => {
      new RegExp("a");
      new RegExp("b");
    });

    expect(built).toBe(2);
    expect(globalThis.RegExp).toBe(real);
  });

  test("puts the real RegExp back when the body throws", async () => {
    const real = globalThis.RegExp;

    await expect(
      countRegExpBuilds(async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");

    expect(globalThis.RegExp).toBe(real);
  });
});

describe("chargingRead", () => {
  test("charges once however often the key is read, and the charge is not zero", async () => {
    // The charge has to outweigh the clock reads a span can pay, or a span timing nothing still
    // adds up to the asserted number and the mutant it exists to kill passes again
    expect(CHARGED_TICKS).toBeGreaterThan(4);

    const spent = await withStubbedClock(async (advance) => {
      const part = chargingRead({}, "text", "hello", advance) as { text: string };
      const start = performance.now();
      void part.text;
      void part.text;
      return performance.now() - start;
    });

    // Two reads of the clock plus the charge, paid on the first read of the key and not again
    expect(spent).toBe(1 + CHARGED_TICKS);
  });
});
