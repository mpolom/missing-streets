import { describe, expect, it } from "vitest";
import type { MissingStreet } from "../../types";
import { filterConfirmedStreets } from "../confirmedStreets";

const makeStreet = (roadId: number, name: string): MissingStreet => ({
  type: "Feature",
  id: roadId,
  geometry: {
    type: "LineString",
    coordinates: [
      [0, 0],
      [1, 1],
    ],
  },
  properties: { roadId, name },
});

describe(filterConfirmedStreets, () => {
  const streets = [
    makeStreet(1, "First Street"),
    makeStreet(2, "Second Street"),
    makeStreet(2, "Second Street segment"),
  ];

  it("hides confirmed road IDs by default", () => {
    expect(filterConfirmedStreets(streets, new Set([2]), false)).toStrictEqual([
      streets[0],
    ]);
  });

  it("includes confirmed roads when requested", () => {
    expect(filterConfirmedStreets(streets, new Set([2]), true)).toStrictEqual(
      streets
    );
  });
});
