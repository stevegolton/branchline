import { describe, expect, it } from "@jest/globals";
import { empty } from "./world.ts";

describe("World", () => {
  it("createEmptyState returns an empty world", () => {
    const world = empty();
    expect(world.tracks).toEqual([]);
    expect(world.trains).toEqual([]);
    expect(world.selectedId).toBeNull();
  });
});
