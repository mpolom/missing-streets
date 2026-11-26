import { REGION_METADATA } from "../src/auto-generated";

const VALID_REGIONS = new Set(REGION_METADATA.map(({ code }) => code));
const DEFAULT_ALLOWED_ORIGINS = ["https://osm-nz.github.io"];
const PREFIX = "confirmed-streets";

interface ConfirmationIdentifier {
  region: string;
  roadId: number;
}

interface ConfirmationRequest extends ConfirmationIdentifier {
  name: string;
  osmName: string;
}

interface OsmUserResponse {
  user?: {
    id?: number;
    display_name?: string;
  };
}

interface KVListPage {
  keys: { name: string }[];
  list_complete: boolean;
  cursor: string;
}

export interface KVNamespace {
  delete(key: string): Promise<void>;
  list(options: {
    prefix: string;
    limit: number;
    cursor?: string;
  }): Promise<KVListPage>;
  put(key: string, value: string): Promise<void>;
}

export interface Env {
  CONFIRMATIONS: KVNamespace;
  REVIEW_ALLOWED_ORIGINS?: string;
}

function isAllowedOrigin(request: Request, env: Env) {
  const origin = request.headers.get("origin");
  if (!origin || origin === new URL(request.url).origin) return true;

  const requestHostname = new URL(request.url).hostname;
  const isLocalWorker =
    requestHostname === "localhost" || requestHostname === "127.0.0.1";
  if (
    isLocalWorker &&
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
  ) {
    return true;
  }

  const configuredOrigins = env.REVIEW_ALLOWED_ORIGINS?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return [...DEFAULT_ALLOWED_ORIGINS, ...(configuredOrigins || [])].includes(
    origin
  );
}

function getHeaders(request: Request, env: Env) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    Vary: "Origin",
  });
  const origin = request.headers.get("origin");
  if (origin && isAllowedOrigin(request, env)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    headers.set("Access-Control-Max-Age", "86400");
  }
  return headers;
}

function jsonResponse(
  request: Request,
  env: Env,
  body: unknown,
  status = 200
): Response {
  return Response.json(body, { status, headers: getHeaders(request, env) });
}

function validateIdentifier(body: unknown): ConfirmationIdentifier | undefined {
  if (!body || typeof body !== "object") return undefined;
  const { region, roadId } = body as Record<string, unknown>;
  if (
    typeof region !== "string" ||
    !VALID_REGIONS.has(region) ||
    typeof roadId !== "number" ||
    !Number.isSafeInteger(roadId)
  ) {
    return undefined;
  }
  return { region, roadId };
}

function validateConfirmation(body: unknown): ConfirmationRequest | undefined {
  const identifier = validateIdentifier(body);
  if (!identifier || !body || typeof body !== "object") return undefined;
  const { name, osmName } = body as Record<string, unknown>;
  if (
    typeof name !== "string" ||
    !name.trim() ||
    name.length > 500 ||
    typeof osmName !== "string" ||
    !osmName.trim() ||
    osmName.length > 500
  ) {
    return undefined;
  }
  return { ...identifier, name: name.trim(), osmName: osmName.trim() };
}

async function getOsmUser(request: Request) {
  const authorization = request.headers.get("authorization");
  const accessToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) return undefined;

  const response = await fetch(
    "https://api.openstreetmap.org/api/0.6/user/details.json",
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!response.ok) return undefined;

  const result: OsmUserResponse = await response.json();
  const { id, display_name: displayName } = result.user || {};
  if (typeof id !== "number" || typeof displayName !== "string") {
    return undefined;
  }
  return { id, displayName };
}

function getRecordKey({ region, roadId }: ConfirmationIdentifier) {
  return `${PREFIX}/${region}/road-${roadId}`;
}

export async function handleRequest(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== "/confirmations") {
    return jsonResponse(request, env, { error: "Not found." }, 404);
  }

  if (!isAllowedOrigin(request, env)) {
    return jsonResponse(request, env, { error: "Origin is not allowed." }, 403);
  }

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: getHeaders(request, env),
    });
  }

  if (request.method === "GET") {
    const region = url.searchParams.get("region");
    if (!region || !VALID_REGIONS.has(region)) {
      return jsonResponse(request, env, { error: "Invalid region." }, 400);
    }

    try {
      const roadIds: number[] = [];
      let cursor: string | undefined;
      let listComplete = false;
      while (!listComplete) {
        const page = await env.CONFIRMATIONS.list({
          prefix: `${PREFIX}/${region}/`,
          limit: 1000,
          ...(cursor ? { cursor } : {}),
        });
        for (const key of page.keys) {
          const match = key.name.match(/\/road-(-?\d+)$/);
          const roadId = match ? Number(match[1]) : NaN;
          if (Number.isSafeInteger(roadId)) roadIds.push(roadId);
        }
        listComplete = page.list_complete;
        if (!listComplete) cursor = page.cursor;
      }

      return jsonResponse(request, env, { roadIds: [...new Set(roadIds)] });
    } catch (error) {
      console.error("Failed to load confirmed streets", error);
      return jsonResponse(
        request,
        env,
        { error: "Failed to load confirmations." },
        500
      );
    }
  }

  if (request.method !== "POST" && request.method !== "DELETE") {
    return jsonResponse(request, env, { error: "Method not allowed." }, 405);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(request, env, { error: "Invalid JSON body." }, 400);
  }

  const identifier = validateIdentifier(body);
  if (!identifier) {
    return jsonResponse(request, env, { error: "Invalid confirmation." }, 400);
  }

  const confirmed = request.method === "POST";
  const confirmation = confirmed ? validateConfirmation(body) : undefined;
  if (confirmed && !confirmation) {
    return jsonResponse(request, env, { error: "Invalid confirmation." }, 400);
  }

  let user;
  try {
    user = await getOsmUser(request);
  } catch (error) {
    console.error("Failed to validate OpenStreetMap login", error);
    return jsonResponse(
      request,
      env,
      { error: "Could not validate OpenStreetMap login." },
      502
    );
  }
  if (!user) {
    return jsonResponse(
      request,
      env,
      { error: "A valid OpenStreetMap login is required." },
      401
    );
  }

  try {
    const key = getRecordKey(identifier);
    if (confirmation) {
      await env.CONFIRMATIONS.put(
        key,
        JSON.stringify({
          ...confirmation,
          confirmedAt: new Date().toISOString(),
          confirmedBy: user,
        })
      );
    } else {
      await env.CONFIRMATIONS.delete(key);
    }

    return jsonResponse(request, env, { confirmed });
  } catch (error) {
    console.error("Failed to update confirmed street", error);
    return jsonResponse(
      request,
      env,
      { error: "Failed to save the confirmation." },
      500
    );
  }
}

const worker = { fetch: handleRequest };

export default worker;
