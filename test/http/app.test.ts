import { readdirSync, readFileSync } from "fs";
import path from "path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import app from "../../src/app";
import { openApiDocument } from "../../src/docs/openapi";
import { sign } from "../../src/storage/signing";

/** HTTP layer without a database: access checks, validation, errors, CORS, docs. */
const KEY = process.env.TEAM_KEY as string;
const ID = "0b9a7c1e-5d3f-4a8b-9c2d-1e2f3a4b5c6d";

describe("HTTP basics", () => {
  it("/health answers UP", async () => {
    const r = await request(app).get("/health");
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("UP");
  });

  it("unknown routes -> 404 in the house error shape", async () => {
    const r = await request(app).get("/api/nope").set("X-Team-Key", KEY);
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({ status: "fail", statusCode: 404 });
  });

  it("does not advertise Express", async () => {
    const r = await request(app).get("/health");
    expect(r.headers["x-powered-by"]).toBeUndefined();
  });
});

describe("team key", () => {
  it("is required for presenter endpoints", async () => {
    expect((await request(app).get("/api/bootstrap")).status).toBe(401);
    expect((await request(app).get("/api/demos").set("X-Team-Key", "wrong")).status).toBe(401);
    expect((await request(app).get("/api/demos").set("X-Team-Key", KEY + "x")).status).toBe(401);
  });

  it("is not needed for the client's public endpoint (validation runs instead)", async () => {
    const r = await request(app).get("/api/public/demos/Not_A_Valid_Slug");
    expect(r.status).toBe(422);
  });
});

describe("validation and errors", () => {
  it("invalid body -> 422 with the field's message", async () => {
    const r = await request(app).post("/api/demos").set("X-Team-Key", KEY).send({ date: "2026-02-30" });
    expect(r.status).toBe(422);
    expect(r.body.message).toBe("date is not a real date");
  });

  it("invalid id -> 422", async () => {
    const r = await request(app).get("/api/demos/123").set("X-Team-Key", KEY);
    expect(r.status).toBe(422);
    expect(r.body.message).toBe("id must be a valid id");
  });

  it("broken JSON -> 400", async () => {
    const r = await request(app).post("/api/demos").set("X-Team-Key", KEY).set("Content-Type", "application/json").send("{bad");
    expect(r.status).toBe(400);
    expect(r.body.message).toBe("Request body is not valid JSON");
  });

  it("unsupported upload type -> 422 before anything is stored", async () => {
    const r = await request(app)
      .post("/api/uploads")
      .set("X-Team-Key", KEY)
      .send({ productId: ID, fileName: "a.avi", sizeBytes: 10, mimeType: "video/avi" });
    expect(r.status).toBe(422);
  });
});

describe("CORS", () => {
  it("allows the configured frontend, with the custom headers and ETag", async () => {
    const r = await request(app)
      .options("/api/demos")
      .set("Origin", "http://localhost:5180")
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "X-Team-Key,Content-Type");
    expect(r.headers["access-control-allow-origin"]).toBe("http://localhost:5180");
    expect(r.headers["access-control-allow-headers"]).toMatch(/X-Team-Key/);
  });

  it("does not allow other websites", async () => {
    const r = await request(app).options("/api/demos").set("Origin", "https://evil.example").set("Access-Control-Request-Method", "POST");
    expect(r.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("local storage links", () => {
  it("refuse a missing, tampered or expired signature", async () => {
    const key = "sales-demo/videos/x/v1/play.mp4";
    const exp = Math.floor(Date.now() / 1000) + 60;
    expect((await request(app).get(`/api/storage-local/objects/${key}`)).status).toBe(403);
    expect((await request(app).get(`/api/storage-local/objects/${key}?exp=${exp}&sig=abc`)).status).toBe(403);
    const past = exp - 120;
    const sig = sign(`GET\n${key}\n${past}`);
    expect((await request(app).get(`/api/storage-local/objects/${key}?exp=${past}&sig=${sig}`)).status).toBe(403);
  });

  it("serve the file with a valid signature (and a missing file is 404, not an error)", async () => {
    const key = "sales-demo/videos/none/v1/play.mp4";
    const exp = Math.floor(Date.now() / 1000) + 60;
    const sig = sign(`GET\n${key}\n${exp}`);
    const r = await request(app).get(`/api/storage-local/objects/${key}?exp=${exp}&sig=${sig}`);
    expect(r.status).toBe(404);
  });
});

describe("API docs", () => {
  it("Swagger UI is served at /api-docs", async () => {
    const r = await request(app).get("/api-docs/");
    expect(r.status).toBe(200);
    expect(r.text).toMatch(/swagger/i);
  });

  it("every route in src/routes is documented", () => {
    const mounts: Record<string, string> = {
      "asset.routes.ts": "/assets",
      "demo.routes.ts": "/demos",
      "flow.routes.ts": "/flows",
      "library.routes.ts": "",
      "product.routes.ts": "/products",
      "public.routes.ts": "/public",
      "upload.routes.ts": "/uploads"
    };
    const dir = path.join(__dirname, "../../src/routes");
    const files = readdirSync(dir).filter((f) => f.endsWith(".routes.ts") && f !== "localStorage.routes.ts");
    expect(files.sort()).toEqual(Object.keys(mounts).sort()); // a new routes file must be added above

    const missing: string[] = [];
    for (const f of files) {
      const src = readFileSync(path.join(dir, f), "utf8");
      for (const [, method, route] of src.matchAll(/router\.(get|post|put|patch|delete)\("([^"]+)"/g)) {
        const full = (mounts[f] + (route === "/" ? "" : route)).replace(/:(\w+)/g, "{$1}") || "/";
        const doc = (openApiDocument.paths as Record<string, Record<string, unknown>>)[full];
        if (!doc?.[method]) missing.push(`${method.toUpperCase()} ${full}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
