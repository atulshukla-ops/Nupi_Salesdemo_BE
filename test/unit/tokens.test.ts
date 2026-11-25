import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import { expiry, sign, verify } from "../../src/storage/signing";
import { issueHostToken, verifyHostToken } from "../../src/sync/hostToken";

describe("signed storage URLs", () => {
  const exp = Math.floor(Date.now() / 1000) + 60;
  const payload = `GET\nkey\n${exp}`;

  it("accepts a valid signature", () => {
    expect(verify(payload, sign(payload), exp)).toBe(true);
  });

  it("refuses a tampered payload, a wrong signature and an expired link", () => {
    const sig = sign(payload);
    expect(verify(`GET\nother\n${exp}`, sig, exp)).toBe(false);
    expect(verify(payload, sig.slice(0, -2) + "xx", exp)).toBe(false);
    expect(verify(payload, "", exp)).toBe(false);
    const past = Math.floor(Date.now() / 1000) - 1;
    expect(verify(`GET\nkey\n${past}`, sign(`GET\nkey\n${past}`), past)).toBe(false);
  });

  it("aligned expiry is rounded up to the boundary (stable, cacheable URLs)", () => {
    const e = expiry(3600, 6 * 3600);
    expect(e % (6 * 3600)).toBe(0);
    expect(e).toBeGreaterThanOrEqual(Math.floor(Date.now() / 1000) + 3600);
  });
});

describe("live console host token", () => {
  const demoId = "0b9a7c1e-5d3f-4a8b-9c2d-1e2f3a4b5c6d";

  it("round-trips the demo, slug and presenter", () => {
    const { token, expiresAt } = issueHostToken(demoId, "2026-11-24-acme-demo-k7f2", "Akash");
    const claims = verifyHostToken(token, "2026-11-24-acme-demo-k7f2");
    expect(claims).toMatchObject({ typ: "sdr-host", sub: demoId, name: "Akash" });
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("is refused for another demo's slug", () => {
    const { token } = issueHostToken(demoId, "slug-a", null);
    expect(verifyHostToken(token, "slug-b")).toBeNull();
  });

  it("is refused when forged, signed with another secret, or of another type", () => {
    expect(verifyHostToken("forged.token.value", "s")).toBeNull();
    const other = jwt.sign({ typ: "sdr-host", sub: demoId, slug: "s" }, "another-secret-another-secret-123");
    expect(verifyHostToken(other, "s")).toBeNull();
    const wrongType = jwt.sign({ typ: "something-else", sub: demoId, slug: "s" }, process.env.HOST_TOKEN_SECRET as string);
    expect(verifyHostToken(wrongType, "s")).toBeNull();
  });

  it("refuses an unsigned token (alg none)", () => {
    const unsigned = jwt.sign({ typ: "sdr-host", sub: demoId, slug: "s" }, "", { algorithm: "none" });
    expect(verifyHostToken(unsigned, "s")).toBeNull();
  });
});
