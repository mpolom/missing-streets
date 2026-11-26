import { memo, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { LatLngBounds } from "leaflet";
import { useMap, useMapEvents } from "react-leaflet";
import { BBox } from "geojson";
import { MissingStreet, type RegionMetadata } from "../types";
import { filterConfirmedStreets } from "../util/confirmedStreets";
import { Street } from "./Street";

const TooBigError: React.FC<{ count: number }> = ({ count }) => (
  <div style={{ padding: 10, background: "#f2bf05", marginTop: 4 }}>
    Zoom in to see the {count.toLocaleString()} issues in this area
  </div>
);

const TooBigErrorWrapper: React.FC<{ count: number }> = ({ count }) =>
  createPortal(
    <TooBigError count={count} />,
    document.querySelector("#inject")!
  );

const [minLat, minLng, maxLat, maxLng] = [0, 1, 2, 3];

const normalBbox = (bounds: LatLngBounds): BBox => [
  bounds.getSouth(), // minLat
  bounds.getWest(), // minLng
  bounds.getNorth(), // maxLat
  bounds.getEast(), // maxLng
];

interface Props {
  data: MissingStreet[];
  hidden: boolean;
  region: RegionMetadata;
  confirmedRoadIds: Set<number>;
  showConfirmed: boolean;
  onConfirmationChange(roadId: number, confirmed: boolean): void;
}
export const Streets = memo<Props>((props) => {
  const {
    data,
    hidden,
    region,
    confirmedRoadIds,
    showConfirmed,
    onConfirmationChange,
  } = props;
  const map = useMap();

  const [bbox, setBbox] = useState<BBox>(() => normalBbox(map.getBounds()));

  const onMove = useCallback(() => {
    setBbox(normalBbox(map.getBounds()));
  }, [map]);

  useMapEvents({ dragend: onMove, zoomend: onMove });

  if (!bbox || hidden) return null;

  const visibleStreets = filterConfirmedStreets(
    data,
    confirmedRoadIds,
    showConfirmed
  ).filter(
    (feature) =>
      feature.bbox![minLat] > bbox[minLat] &&
      feature.bbox![maxLat] < bbox[maxLat] &&
      feature.bbox![minLng] > bbox[minLng] &&
      feature.bbox![maxLng] < bbox[maxLng]
  );

  if (visibleStreets.length > 200) {
    return <TooBigErrorWrapper count={visibleStreets.length} />;
  }

  return (
    <>
      {visibleStreets.map((street) => (
        <Street
          key={street.id}
          street={street}
          region={region}
          confirmed={confirmedRoadIds.has(street.properties.roadId)}
          onConfirmationChange={(confirmed) =>
            onConfirmationChange(street.properties.roadId, confirmed)
          }
        />
      ))}
    </>
  );
});
Streets.displayName = "Streets";
