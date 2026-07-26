import { describe, expect, it } from "vitest";

describe("bootstrap smoke", () => {
  it("vitest runner is wired", () => {
    expect(1 + 1).toBe(2);
  });
});
