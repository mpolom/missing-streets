import { useCallback, useEffect, useMemo, useState } from "react";
import TimeAgo from "react-timeago-i18n";
import { MapContainer, ScaleControl } from "react-leaflet";
import userRegion from "get-region";
import { MapHook, Imagery, Streets, WholeNetwork } from "./map-layers";
import type { MissingStreet, RegionMetadata } from "./types";
import { useKeyboardShortcut } from "./util";
import { HelpModal, Modal } from "./components";
import { REGION_METADATA } from "./auto-generated";
import {
  getConfirmedRoadIds,
  isConfirmationApiConfigured,
} from "./api/confirmations";
import { filterConfirmedStreets } from "./util/confirmedStreets";

import "./index.css";
import "leaflet/dist/leaflet.css";
import { SYNC_TIME } from "./util/date";

interface ReviewState {
  regionCode: string;
  roadIds: Set<number>;
  error?: string;
}

const isInIframe = window.self !== window.top;
const skipIframeRedirect =
  !!new URLSearchParams(window.location.search).get("no_redirect") ||
  window.location.hostname === "localhost";
const assetBaseUrl = import.meta.env.BASE_URL.endsWith("/")
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`;

const qsRegion = new URLSearchParams(window.location.search).get("region");
const DEFAULT_REGION =
  // prefer the region from the URL
  REGION_METADATA.find((region) => region.code === qsRegion) ||
  // fallback to the user's current country
  REGION_METADATA.find((region) =>
    userRegion.country.some((code) => region.code.startsWith(code))
  ) ||
  // fallback to the first country in the list
  REGION_METADATA[0];

// the non-iframe version is no longer allowed. unless you included ?no_redirect=1 in the URL.
if (!isInIframe && !skipIframeRedirect) {
  window.location.replace(
    `https://osm-nz.github.io/osm-conflation-engine/#/project/::missing_streets::${
      DEFAULT_REGION.code
    }`
  );
}

export const App: React.FC = () => {
  const [region, setRegion] = useState<RegionMetadata>(DEFAULT_REGION);
  const [data, setData] = useState<MissingStreet[]>();
  const [reviewState, setReviewState] = useState<ReviewState>(() => ({
    regionCode: "",
    roadIds: new Set(),
  }));
  const confirmationApiConfigured = isConfirmationApiConfigured();
  const confirmationsReady =
    !confirmationApiConfigured || reviewState.regionCode === region.code;
  const confirmedRoadIds = useMemo(
    () =>
      reviewState.regionCode === region.code
        ? reviewState.roadIds
        : new Set<number>(),
    [region.code, reviewState]
  );
  const confirmationError = confirmationApiConfigured
    ? reviewState.regionCode === region.code
      ? reviewState.error
      : undefined
    : "Shared confirmations are not configured for this deployment.";
  const [showConfirmed, setShowConfirmed] = useState(false);
  const [error, setError] = useState<unknown>();
  const [lastUpdated, setLastUpdated] = useState<string>();
  const [modalOpen, setModalOpen] = useState(false);
  const [infoModalOpen, setInfoModalOpen] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    // write to the URL's ?region=* param
    const url = new URL(window.location.href);
    url.searchParams.set("region", region.code);
    window.history.replaceState("", "", url);
  }, [region]);

  const home = useMemo(() => {
    try {
      const [z, lat, lon] = localStorage
        .getItem(`mapExtent-${region.code}`)!
        .split("/")
        .map(Number);
      if (Number.isNaN(z + lat + lon)) throw new Error(".");
      return { z, lat, lon };
    } catch {
      return { z: 12, ...region.centroid };
    }
  }, [region]);

  const toggleHidden = useCallback(() => setHidden((c) => !c), []);

  useKeyboardShortcut("h", toggleHidden);

  useEffect(() => {
    fetch(`${assetBaseUrl}conflationResult-${region.code}.geo.json`)
      .then((response) => {
        if (!response.ok) {
          throw new Error(
            `Failed to load missing streets: HTTP ${response.status}`
          );
        }
        return response.json();
      })
      .then((geojson) => {
        setData(geojson.features);
        setLastUpdated(geojson.lastUpdated);
      })
      .catch(setError);
  }, [region]);

  useEffect(() => {
    const controller = new AbortController();
    if (!isConfirmationApiConfigured()) {
      return () => controller.abort();
    }

    getConfirmedRoadIds(region.code, controller.signal)
      .then((roadIds) => {
        setReviewState({ regionCode: region.code, roadIds: new Set(roadIds) });
      })
      .catch((fetchError: unknown) => {
        if (controller.signal.aborted) return;
        setReviewState({
          regionCode: region.code,
          roadIds: new Set(),
          error:
            fetchError instanceof Error
              ? fetchError.message
              : "Failed to load shared confirmations.",
        });
      });

    return () => controller.abort();
  }, [region.code]);

  const onConfirmationChange = useCallback(
    (roadId: number, confirmed: boolean) => {
      setReviewState((current) => {
        const roadIds =
          current.regionCode === region.code
            ? current.roadIds
            : new Set<number>();
        const updated = new Set(roadIds);
        if (confirmed) updated.add(roadId);
        else updated.delete(roadId);
        return { regionCode: region.code, roadIds: updated };
      });
    },
    [region.code]
  );

  const downloadGeoJson = useCallback(() => {
    if (!data) return;

    const features = filterConfirmedStreets(
      data,
      confirmedRoadIds,
      showConfirmed
    );
    const blob = new Blob(
      [JSON.stringify({ type: "FeatureCollection", features })],
      { type: "application/geo+json" }
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${region.code}.geo.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [confirmedRoadIds, data, region.code, showConfirmed]);

  const buttonRow = (
    <>
      <button
        className="nice"
        type="button"
        disabled={!data}
        onClick={downloadGeoJson}
      >
        Export to GeoJson
      </button>{" "}
      {data && confirmationsReady && (
        <button
          className="nice"
          type="button"
          aria-pressed={showConfirmed}
          disabled={!!confirmationError}
          onClick={() => setShowConfirmed((visible) => !visible)}
        >
          {showConfirmed ? "Hide" : "Show"} confirmed roads (
          {confirmedRoadIds.size})
        </button>
      )}{" "}
      {confirmationError && <small role="alert">{confirmationError}</small>}{" "}
      <button className="nice" type="button" onClick={() => setModalOpen(true)}>
        Help
      </button>{" "}
      <button
        className="nice"
        type="button"
        onClick={() =>
          window.open(
            "https://wiki.osm.org/New_Zealand/Missing_Streets",
            "_blank",
            "noopener noreferrer"
          )
        }
      >
        Documentation
      </button>
    </>
  );

  return (
    <>
      {modalOpen && (
        <HelpModal region={region} onClose={() => setModalOpen(false)} />
      )}
      {infoModalOpen && (
        <Modal onClose={() => setInfoModalOpen(false)}>
          Running the sync should happen automatically at {SYNC_TIME}. If the
          data hasn’t been updated recently,{" "}
          <a
            href="https://osm.org/message/new/❤️‍🔥_import"
            target="_blank"
            rel="noreferrer noopener"
          >
            send me a message on OpenStreetMap
          </a>
          .
        </Modal>
      )}
      {isInIframe ? (
        <div className="iframe-absolute">
          {buttonRow}
          <div id="inject" />
          <div id="inject-modal" />
        </div>
      ) : (
        <aside>
          <div className="side-by-side">
            <div>
              <h3>
                Missing Streets in{" "}
                <a
                  href={region.source}
                  target="_blank"
                  rel="noopener"
                  title="View data source"
                >
                  <img
                    src={region.icon}
                    alt="flag"
                    style={{ height: 20, verticalAlign: "middle" }}
                  />
                </a>{" "}
                <select
                  value={region.code}
                  onChange={(event) => {
                    const regionId = event.target.value;
                    const newRegion = REGION_METADATA.find(
                      (item) => item.code === regionId
                    )!;
                    setRegion(newRegion);
                    setData(undefined);
                    setError(undefined);
                  }}
                >
                  {REGION_METADATA.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </h3>
              {lastUpdated && (
                <small>
                  Data updated <TimeAgo date={lastUpdated} />
                  <button
                    className="small"
                    type="button"
                    onClick={() => setInfoModalOpen(true)}
                  >
                    ?
                  </button>
                </small>
              )}
            </div>
            <div>{buttonRow}</div>
          </div>
          <div id="inject" />
          <div id="inject-modal" />
        </aside>
      )}
      {error ? (
        <div style={{ padding: 10, background: "#f30", marginTop: 4 }}>
          Failed to load list of missing streets.
        </div>
      ) : data && confirmationsReady ? (
        <MapContainer
          id="map"
          center={[home.lat, home.lon]}
          zoom={home.z}
          scrollWheelZoom
          style={isInIframe ? { height: "100vh" } : {}}
        >
          <ScaleControl position="bottomleft" />
          <MapHook region={region} />
          <Imagery />
          <Streets
            data={data}
            hidden={hidden}
            region={region}
            confirmedRoadIds={confirmedRoadIds}
            showConfirmed={showConfirmed}
            onConfirmationChange={onConfirmationChange}
          />
          {region.code === "NZ" && (
            <WholeNetwork missingStreets={data} hidden={hidden} />
          )}
        </MapContainer>
      ) : (
        <>Loading…</>
      )}
    </>
  );
};
