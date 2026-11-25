import { describe, expect, it } from "vitest";
import { kebab, makeSlug } from "../../src/services/slug.service";

describe("client link slug", () => {
  it("has the same format as the frontend: date-client-name-suffix", () => {
    const slug = makeSlug("2026-11-24", "Acme Retail Pvt. Ltd.", "Product walkthrough");
    expect(slug).toMatch(/^2026-11-24-acme-retail-pvt-ltd-product-walkthrough-[a-z2-9]{4}$/);
  });

  it("skips an empty client name", () => {
    expect(makeSlug("2026-11-24", "", "Demo")).toMatch(/^2026-11-24-demo-[a-z2-9]{4}$/);
  });

  it("only contains characters the relay and public route accept", () => {
    const slug = makeSlug("2026-11-24", "नमस्ते Café", "ÜBER demo!!");
    expect(slug).toMatch(/^[a-z0-9-]{1,160}$/);
  });

  it("is different each time (random suffix)", () => {
    const many = new Set(Array.from({ length: 50 }, () => makeSlug("2026-11-24", "a", "b")));
    expect(many.size).toBeGreaterThan(45);
  });

  it("kebab() cuts long names", () => {
    expect(kebab("x".repeat(200)).length).toBe(48);
  });
});
