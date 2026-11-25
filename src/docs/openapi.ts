import fs from "fs";
import Joi from "joi";
import path from "path";
import env from "../configs/env";
import { listAssetsQuerySchema, reorderAssetsSchema, updateAssetSchema } from "../validators/asset.validator";
import {
  createDemoSchema,
  createFlowSchema,
  demoFromFlowSchema,
  listQuerySchema,
  saveAsFlowSchema,
  updateDemoSchema,
  updateFlowSchema
} from "../validators/demo.validator";
import { createProductSchema, reorderProductsSchema, updateProductSchema } from "../validators/product.validator";
import { updateSettingsSchema } from "../validators/settings.validator";
import { completeUploadSchema, partUrlsSchema, replaceUploadSchema, startUploadSchema } from "../validators/upload.validator";
import { joiToOpenApi, joiToParameters } from "./joiToOpenApi";

/**
 * OpenAPI document served at /api-docs (like be-admin-portal). Request bodies and query
 * parameters are generated from the Joi validators. Every response uses the house envelope:
 *   success: { status: "success", act, message, data }      error: { status, statusCode, message }
 */
type Op = {
  method: "get" | "post" | "put" | "patch" | "delete";
  path: string;
  tag: string;
  summary: string;
  body?: Joi.Schema;
  query?: Joi.ObjectSchema;
  open?: boolean; // no team key
  notes?: string;
};

const ops: Op[] = [
  // library
  { method: "get", path: "/bootstrap", tag: "Library", summary: "Everything the presenter app needs at start: settings, products, assets (with thumbnail URLs), flows" },
  { method: "get", path: "/trash", tag: "Library", summary: "Deleted assets, demos and flows, with the date each is purged" },
  { method: "get", path: "/settings", tag: "Library", summary: "Company About text and the three highlights" },
  { method: "put", path: "/settings", tag: "Library", summary: "Replace the About text and highlights", body: updateSettingsSchema },

  // products
  { method: "get", path: "/products", tag: "Products", summary: "Active products in display order" },
  { method: "post", path: "/products", tag: "Products", summary: "Create a product (name is stored in capitals; duplicates -> 409)", body: createProductSchema },
  { method: "post", path: "/products/reorder", tag: "Products", summary: "Set the order of all active products", body: reorderProductsSchema },
  { method: "patch", path: "/products/{id}", tag: "Products", summary: "Edit a product", body: updateProductSchema },
  { method: "delete", path: "/products/{id}", tag: "Products", summary: "Archive a product" },
  { method: "post", path: "/products/{id}/restore", tag: "Products", summary: "Restore an archived product" },

  // assets
  { method: "get", path: "/assets", tag: "Assets", summary: "Assets, optionally of one product", query: listAssetsQuerySchema },
  { method: "post", path: "/assets/reorder", tag: "Assets", summary: "Set the order of a product's assets", body: reorderAssetsSchema },
  { method: "get", path: "/assets/{id}", tag: "Assets", summary: "One asset (status uploading | processing | ready | failed)" },
  { method: "get", path: "/assets/{id}/usage", tag: "Assets", summary: "Demos and flows that use this asset" },
  { method: "get", path: "/assets/{id}/playback-url", tag: "Assets", summary: "Short-lived signed URL to play the video (409 while not ready)" },
  { method: "patch", path: "/assets/{id}", tag: "Assets", summary: "Edit title, description, notes or move to another product", body: updateAssetSchema },
  { method: "delete", path: "/assets/{id}", tag: "Assets", summary: "Move to Trash (returns where it was used)" },
  { method: "post", path: "/assets/{id}/restore", tag: "Assets", summary: "Restore from Trash" },
  { method: "post", path: "/assets/{id}/replace-upload", tag: "Uploads", summary: "Start uploading a new version of the video; the old one keeps playing until the new one is ready", body: replaceUploadSchema },

  // uploads
  { method: "post", path: "/uploads", tag: "Uploads", summary: "Start a video upload: creates the asset and returns upload id, part size and part count", body: startUploadSchema },
  { method: "post", path: "/uploads/{id}/part-urls", tag: "Uploads", summary: "Signed URLs to PUT each part directly to storage (max 100 per call)", body: partUrlsSchema },
  { method: "get", path: "/uploads/{id}/parts", tag: "Uploads", summary: "Parts already uploaded and the ones missing (resume after a network drop)" },
  { method: "post", path: "/uploads/{id}/complete", tag: "Uploads", summary: "Finish the upload (all parts with their ETag); the video is then processed by the worker", body: completeUploadSchema },
  { method: "delete", path: "/uploads/{id}", tag: "Uploads", summary: "Cancel an upload" },

  // demos
  { method: "get", path: "/demos", tag: "Demos", summary: "Client demos, newest first", query: listQuerySchema },
  { method: "post", path: "/demos", tag: "Demos", summary: "Create a client demo (optionally from a Standard Flow)", body: createDemoSchema },
  { method: "get", path: "/demos/{id}", tag: "Demos", summary: "One demo with its run of show" },
  { method: "patch", path: "/demos/{id}", tag: "Demos", summary: "Edit a demo (changing the date keeps the client link)", body: updateDemoSchema },
  { method: "delete", path: "/demos/{id}", tag: "Demos", summary: "Move to Trash (the client link stops working)" },
  { method: "post", path: "/demos/{id}/restore", tag: "Demos", summary: "Restore from Trash" },
  { method: "post", path: "/demos/{id}/duplicate", tag: "Demos", summary: "Copy a demo (new client link)" },
  { method: "post", path: "/demos/{id}/save-as-flow", tag: "Demos", summary: "Save this demo's run of show as a Standard Flow", body: saveAsFlowSchema },
  {
    method: "post",
    path: "/demos/{id}/live-token",
    tag: "Live",
    summary: "Host token for the live console",
    notes: "Returns { token, expiresAt, slug, syncUrl }. Open `syncUrl?slug=…&role=host&token=…` as a WebSocket (add `&takeover=1` to take over from another console)."
  },
  { method: "get", path: "/demos/{id}/sessions", tag: "Live", summary: "Past live sessions: presenter, start/end, viewers by name, peak viewers" },

  // flows
  { method: "get", path: "/flows", tag: "Standard Flows", summary: "Standard Flows (templates)" },
  { method: "post", path: "/flows", tag: "Standard Flows", summary: "Create a Standard Flow", body: createFlowSchema },
  { method: "get", path: "/flows/{id}", tag: "Standard Flows", summary: "One flow" },
  { method: "patch", path: "/flows/{id}", tag: "Standard Flows", summary: "Edit a flow", body: updateFlowSchema },
  { method: "delete", path: "/flows/{id}", tag: "Standard Flows", summary: "Move to Trash" },
  { method: "post", path: "/flows/{id}/restore", tag: "Standard Flows", summary: "Restore from Trash" },
  { method: "post", path: "/flows/{id}/demos", tag: "Standard Flows", summary: "Create a client demo from this flow", body: demoFromFlowSchema },

  // public
  {
    method: "get",
    path: "/public/demos/{slug}",
    tag: "Public (client viewer)",
    summary: "Name, client and date of a demo for the client's watch page",
    open: true,
    notes: "No team key. Viewers then open `/sync?slug=…&role=viewer` as a WebSocket."
  }
];

const envelope = {
  type: "object",
  properties: { status: { type: "string", example: "success" }, act: { type: "string" }, message: { type: "string" }, data: {} }
};
const errorBody = {
  type: "object",
  properties: { status: { type: "string", example: "fail" }, statusCode: { type: "integer" }, message: { type: "string" } }
};
const err = (description: string) => ({ description, content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } });

const paths: Record<string, Record<string, unknown>> = {};
for (const op of ops) {
  const parameters: unknown[] = [];
  const pathParam = op.path.match(/\{(\w+)\}/)?.[1];
  if (pathParam) parameters.push({ name: pathParam, in: "path", required: true, schema: { type: "string", ...(pathParam === "id" ? { format: "uuid" } : {}) } });
  if (op.query) parameters.push(...joiToParameters(op.query, "query"));

  const responses: Record<string, unknown> = {
    200: { description: "Success", content: { "application/json": { schema: { $ref: "#/components/schemas/Success" } } } }
  };
  if (!op.open) responses[401] = err("Missing or invalid team key");
  if (pathParam) responses[404] = err("Not found");
  if (op.body || op.query || pathParam) responses[422] = err("Validation failed (message says which field)");
  if (op.method !== "get") responses[409] = err("Conflict with the current state (duplicate name, not ready yet, …)");

  paths[op.path] ??= {};
  paths[op.path][op.method] = {
    tags: [op.tag],
    summary: op.summary,
    ...(op.notes ? { description: op.notes } : {}),
    ...(op.open ? { security: [] } : {}),
    ...(parameters.length ? { parameters } : {}),
    ...(op.body ? { requestBody: { required: true, content: { "application/json": { schema: joiToOpenApi(op.body) } } } } : {}),
    responses
  };
}

// package.json sits two folders up from both src/docs and build/docs
const { version } = JSON.parse(fs.readFileSync(path.join(__dirname, "../../package.json"), "utf8")) as { version: string };

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "NupiPay Sales Demo Room - API",
    version,
    description: [
      "Shared library, video uploads, client demos and the live sync relay.",
      "",
      "**Access:** send the shared team key in the `X-Team-Key` header (Authorize button). Optional `X-Presenter-Name` is recorded on live sessions.",
      "",
      "**Live sync (WebSocket, not shown as an endpoint):** `ws(s)://<host>/sync?slug=<slug>&role=host|viewer[&token=…][&takeover=1]`.",
      "Close codes: 4000 bad request, 4001 bad host token, 4003 viewer limit, 4004 unknown demo, 4009 already open in another console, 4010 replaced by another console."
    ].join("\n")
  },
  servers: [{ url: `${env.publicBaseUrl}/api` }],
  security: [{ teamKey: [] }],
  components: {
    securitySchemes: { teamKey: { type: "apiKey", in: "header", name: "X-Team-Key" } },
    schemas: { Success: envelope, Error: errorBody }
  },
  paths
};
