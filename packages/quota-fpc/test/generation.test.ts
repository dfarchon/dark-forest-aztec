import { describe, expect, test } from "vitest";
import {
  SECONDS_PER_DAY,
  generationAt,
  generationEndsAt,
  isGenerationStale,
  millisUntilReset,
  sponsorableGenerations,
} from "../src/generation.js";

/** 2026-07-29T00:00:00Z */
const DAY_START = 1_785_024_000n;

describe("generation arithmetic", () => {
  test("a day maps to one generation, and midnight starts the next", () => {
    const generation = generationAt(DAY_START);
    expect(generationAt(DAY_START + 1n)).toBe(generation);
    expect(generationAt(DAY_START + SECONDS_PER_DAY - 1n)).toBe(generation);
    expect(generationAt(DAY_START + SECONDS_PER_DAY)).toBe(generation + 1);
  });

  test("the reset countdown reaches zero exactly at midnight", () => {
    expect(millisUntilReset(DAY_START)).toBe(Number(SECONDS_PER_DAY) * 1000);
    expect(millisUntilReset(DAY_START + SECONDS_PER_DAY - 1n)).toBe(1000);
    expect(millisUntilReset(DAY_START + SECONDS_PER_DAY)).toBe(
      Number(SECONDS_PER_DAY) * 1000,
    );
  });

  test("generationEndsAt is the following midnight", () => {
    expect(generationEndsAt(generationAt(DAY_START))).toBe(
      DAY_START + SECONDS_PER_DAY,
    );
  });

  test("tomorrow is sponsorable only inside the closing grace window", () => {
    const today = generationAt(DAY_START);

    // Mid-day: today only.
    expect(sponsorableGenerations(DAY_START + 43_200n)).toEqual([today]);

    // 11 minutes before midnight: still outside the 10-minute window.
    expect(sponsorableGenerations(DAY_START + SECONDS_PER_DAY - 660n)).toEqual([
      today,
    ]);

    // 9 minutes before midnight: tomorrow becomes acceptable.
    expect(sponsorableGenerations(DAY_START + SECONDS_PER_DAY - 540n)).toEqual([
      today,
      today + 1,
    ]);
  });

  test("a generation held across midnight goes stale", () => {
    const today = generationAt(DAY_START);
    expect(isGenerationStale(today, DAY_START + 3_600n)).toBe(false);
    // Same generation, but the chain has rolled into the next day.
    expect(isGenerationStale(today, DAY_START + SECONDS_PER_DAY + 1n)).toBe(
      true,
    );
    // Tomorrow's generation is premature at mid-day.
    expect(isGenerationStale(today + 1, DAY_START + 43_200n)).toBe(true);
  });

  test("negative chain time is rejected rather than silently wrapping", () => {
    expect(() => generationAt(-1n)).toThrow(RangeError);
  });
});
