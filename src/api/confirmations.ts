export interface Confirmation {
  region: string;
  roadId: number;
  name: string;
  osmName: string;
  confirmedAt: string;
  confirmedBy: {
    id: number;
    displayName: string;
  };
}

const getApiUrl = () => {
  const configuredUrl = import.meta.env.REACT_APP_REVIEW_API_URL;
  if (configuredUrl) return configuredUrl.replace(/\/$/, "");

  if (
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
  ) {
    return "http://127.0.0.1:8787/confirmations";
  }

  return undefined;
};

export const isConfirmationApiConfigured = () => !!getApiUrl();

export async function getConfirmedRoadIds(
  region: string,
  signal: AbortSignal
): Promise<number[]> {
  const apiUrl = getApiUrl();
  if (!apiUrl) throw new Error("Shared confirmations are not configured.");

  const response = await fetch(
    `${apiUrl}?region=${encodeURIComponent(region)}`,
    { signal }
  );
  if (!response.ok) {
    throw new Error(
      `Failed to load shared confirmations: HTTP ${response.status}`
    );
  }

  const result: { roadIds: number[] } = await response.json();
  return result.roadIds;
}

export async function updateConfirmation(
  confirmation: Pick<Confirmation, "region" | "roadId"> &
    Partial<Pick<Confirmation, "name" | "osmName">>,
  confirmed: boolean,
  accessToken: string
): Promise<void> {
  const apiUrl = getApiUrl();
  if (!apiUrl) throw new Error("Shared confirmations are not configured.");

  const response = await fetch(apiUrl, {
    method: confirmed ? "POST" : "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(confirmation),
  });
  if (!response.ok) {
    throw new Error(
      `Failed to ${confirmed ? "confirm" : "restore"} this road: HTTP ${response.status}`
    );
  }
}
