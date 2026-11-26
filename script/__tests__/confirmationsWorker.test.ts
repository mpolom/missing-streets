import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleRequest,
  type Env,
  type KVNamespace,
} from "../../cloudflare/worker";

const storedEntries = new Map<string, string>();
const list = vi.fn(async () => ({
  keys: [] as { name: string }[],
  list_complete: true,
  cursor: "",
}));
const put = vi.fn(async (key: string, value: string) => {
  storedEntries.set(key, value);
});
const deleteKey = vi.fn(async (key: string) => {
  storedEntries.delete(key);
});
const namespace: KVNamespace = { list, put, delete: deleteKey };
const env: Env = {
  CONFIRMATIONS: namespace,
  REVIEW_ALLOWED_ORIGINS: "https://osm-nz.github.io",
};

describe("Cloudflare confirmation Worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storedEntries.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns confirmed road IDs across KV list pages", async () => {
    list
      .mockResolvedValueOnce({
        keys: [
          { name: "confirmed-streets/NZ/road-42" },
          { name: "confirmed-streets/NZ/road--7" },
          { name: "confirmed-streets/NZ/invalid" },
        ],
        list_complete: false,
        cursor: "next-page",
      })
      .mockResolvedValueOnce({
        keys: [{ name: "confirmed-streets/NZ/road-42" }],
        list_complete: true,
        cursor: "",
      });

    const response = await handleRequest(
      new Request("https://review.example/confirmations?region=NZ"),
      env
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({
      roadIds: [42, -7],
    });
    expect(list).toHaveBeenNthCalledWith(1, {
      prefix: "confirmed-streets/NZ/",
      limit: 1000,
    });
    expect(list).toHaveBeenNthCalledWith(2, {
      prefix: "confirmed-streets/NZ/",
      limit: 1000,
      cursor: "next-page",
    });
  });

  it("rejects invalid regions and origins", async () => {
    const invalidRegion = await handleRequest(
      new Request("https://review.example/confirmations?region=invalid"),
      env
    );
    expect(invalidRegion.status).toBe(400);

    const invalidOrigin = await handleRequest(
      new Request("https://review.example/confirmations?region=NZ", {
        headers: { Origin: "https://untrusted.example" },
      }),
      env
    );
    expect(invalidOrigin.status).toBe(403);
    expect(list).not.toHaveBeenCalled();
  });

  it("requires a valid OpenStreetMap login to write", async () => {
    const response = await handleRequest(
      new Request("https://review.example/confirmations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          region: "NZ",
          roadId: 42,
          name: "Main Road",
          osmName: "Main St",
        }),
      }),
      env
    );

    expect(response.status).toBe(401);
    expect(put).not.toHaveBeenCalled();
  });

  it("stores an authenticated confirmation and reviewer identity", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ user: { id: 123, display_name: "Mapper" } })
        )
    );

    const response = await handleRequest(
      new Request("https://review.example/confirmations", {
        method: "POST",
        headers: {
          Authorization: "Bearer osm-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          region: "NZ",
          roadId: 42,
          name: " Source Road ",
          osmName: " Local Road ",
        }),
      }),
      env
    );

    expect(response.status).toBe(200);
    expect(put).toHaveBeenCalledWith(
      "confirmed-streets/NZ/road-42",
      expect.any(String)
    );
    const storedValue = JSON.parse(
      storedEntries.get("confirmed-streets/NZ/road-42") || ""
    );
    expect(storedValue).toStrictEqual(
      expect.objectContaining({
        name: "Source Road",
        osmName: "Local Road",
        confirmedBy: { id: 123, displayName: "Mapper" },
      })
    );
    expect(storedValue.confirmedAt).toStrictEqual(expect.any(String));
  });

  it("restores a confirmed road without requiring a name", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ user: { id: 123, display_name: "Mapper" } })
        )
    );

    const response = await handleRequest(
      new Request("https://review.example/confirmations", {
        method: "DELETE",
        headers: {
          Authorization: "Bearer osm-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ region: "NZ", roadId: 42 }),
      }),
      env
    );

    expect(response.status).toBe(200);
    expect(deleteKey).toHaveBeenCalledWith("confirmed-streets/NZ/road-42");
  });

  it("handles CORS preflight for the configured frontend", async () => {
    const response = await handleRequest(
      new Request("https://review.example/confirmations", {
        method: "OPTIONS",
        headers: { Origin: "https://osm-nz.github.io" },
      }),
      env
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://osm-nz.github.io"
    );
  });

  it("allows localhost frontend origins only when the Worker is local", async () => {
    const localResponse = await handleRequest(
      new Request("http://127.0.0.1:8787/confirmations?region=NZ", {
        headers: { Origin: "http://localhost:5173" },
      }),
      env
    );
    expect(localResponse.status).toBe(200);
    expect(localResponse.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:5173"
    );

    const deployedResponse = await handleRequest(
      new Request("https://review.example/confirmations?region=NZ", {
        headers: { Origin: "http://localhost:5173" },
      }),
      env
    );
    expect(deployedResponse.status).toBe(403);
  });
});
