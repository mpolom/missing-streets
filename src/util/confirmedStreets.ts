import type { MissingStreet } from "../types";

export function filterConfirmedStreets(
  streets: MissingStreet[],
  confirmedRoadIds: Set<number>,
  showConfirmed: boolean
) {
  if (showConfirmed) return streets;
  return streets.filter(
    (street) => !confirmedRoadIds.has(street.properties.roadId)
  );
}
