import { describe, expect, it } from "@jest/globals";
import { emptyWorld } from "./world.ts";

describe("World", () => {
  it("createEmptyState returns an empty world", () => {
    const world = emptyWorld;
    expect(world.tracks).toEqual([]);
    expect(world.trains).toEqual([]);
    expect(world.selectedId).toBeNull();
  });
});
