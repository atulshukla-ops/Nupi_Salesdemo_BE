import Joi from "joi";
import { describe, expect, it } from "vitest";
import { isoDate } from "../../src/validators/common.validator";
import { createDemoSchema, runOfShowSchema, updateDemoSchema } from "../../src/validators/demo.validator";
import { createProductSchema } from "../../src/validators/product.validator";
import { updateSettingsSchema } from "../../src/validators/settings.validator";
import { completeUploadSchema, startUploadSchema } from "../../src/validators/upload.validator";

const id = (n: number) => `0b9a7c1e-5d3f-4a8b-9c2d-${String(n).padStart(12, "0")}`;
const ok = (schema: Joi.Schema, v: unknown) => !schema.validate(v).error;
const msg = (schema: Joi.Schema, v: unknown) => schema.validate(v).error?.message;

describe("validators", () => {
  it("dates must be real calendar dates", () => {
    expect(ok(isoDate(), "2026-11-24")).toBe(true);
    expect(ok(isoDate(), "2026-02-30")).toBe(false);
    expect(ok(isoDate(), "24-11-2026")).toBe(false);
  });

  it("a new demo needs a date; the name defaults to 'Product demo'", () => {
    expect(ok(createDemoSchema, {})).toBe(false);
    expect(createDemoSchema.validate({ date: "2026-11-24" }).value.name).toBe("Product demo");
  });

  it("an empty update is refused", () => {
    expect(msg(updateDemoSchema, {})).toBe("Nothing to update");
  });

  it("run of show refuses the same product or asset twice", () => {
    const item = { assetId: id(2), enabled: true };
    expect(ok(runOfShowSchema, [{ productId: id(1), enabled: true, items: [item] }])).toBe(true);
    expect(ok(runOfShowSchema, [{ productId: id(1), enabled: true, items: [item, item] }])).toBe(false);
    expect(
      ok(runOfShowSchema, [
        { productId: id(1), enabled: true, items: [] },
        { productId: id(1), enabled: false, items: [] }
      ])
    ).toBe(false);
  });

  it("product colours must be #RRGGBB", () => {
    expect(ok(createProductSchema, { name: "UPI", color: "#AFDAE1" })).toBe(true);
    expect(ok(createProductSchema, { name: "UPI", color: "red" })).toBe(false);
  });

  it("settings need exactly three highlights", () => {
    const p = { title: "t", text: "x" };
    expect(ok(updateSettingsSchema, { aboutText: "", pillars: [p, p, p] })).toBe(true);
    expect(msg(updateSettingsSchema, { aboutText: "", pillars: [p, p] })).toBe("Exactly three highlights are required");
  });

  it("uploads accept only supported video types and sizes", () => {
    const base = { productId: id(1), fileName: "a.mp4", sizeBytes: 1000, mimeType: "video/mp4" };
    expect(ok(startUploadSchema, base)).toBe(true);
    expect(msg(startUploadSchema, { ...base, mimeType: "video/avi" })).toBe("Only videos (MP4, MOV, WebM, M4V) or decks (PPTX, PPT, PDF) can be uploaded");
    expect(msg(startUploadSchema, { ...base, sizeBytes: 3 * 1024 ** 3 })).toMatch(/too large/);
  });

  it("decks: PPTX, PPT and PDF are accepted, up to 200 MB", () => {
    const pptx = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    const base = { productId: id(1), fileName: "deck.pptx", sizeBytes: 5_000_000, mimeType: pptx };
    expect(ok(startUploadSchema, base)).toBe(true);
    expect(ok(startUploadSchema, { ...base, fileName: "deck.pdf", mimeType: "application/pdf" })).toBe(true);
    expect(ok(startUploadSchema, { ...base, fileName: "deck.ppt", mimeType: "application/vnd.ms-powerpoint" })).toBe(true);
    expect(msg(startUploadSchema, { ...base, sizeBytes: 250 * 1024 ** 2 })).toBe("Deck is too large. The limit is 200 MB");
    // a 250 MB video is still fine
    expect(ok(startUploadSchema, { ...base, fileName: "a.mp4", mimeType: "video/mp4", sizeBytes: 250 * 1024 ** 2 })).toBe(true);
  });

  it("completing an upload refuses duplicate part numbers", () => {
    const p = { partNumber: 1, etag: '"abc"' };
    expect(ok(completeUploadSchema, { parts: [p] })).toBe(true);
    expect(ok(completeUploadSchema, { parts: [p, p] })).toBe(false);
  });
});
