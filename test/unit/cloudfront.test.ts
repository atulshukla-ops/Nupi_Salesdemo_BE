import { createVerify, generateKeyPairSync } from "crypto";
import { describe, expect, it } from "vitest";

/** CloudFront signed playback URLs (no network: signing is done locally with the private key). */
describe("CloudFront signed URLs", () => {
  it("are signed with the key pair, expire when asked, and verify with the public key", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    Object.assign(process.env, {
      STORAGE_DRIVER: "s3",
      S3_BUCKET: "storagenupi",
      CLOUDFRONT_DOMAIN: "https://d111111abcdef8.cloudfront.net/",
      CLOUDFRONT_KEY_PAIR_ID: "K2TESTKEYID",
      CLOUDFRONT_PRIVATE_KEY: pem.replace(/\n/g, "\\n") // as written on one line in .env
    });
    const { s3Driver } = await import("../../src/storage/s3Storage.driver");

    const key = "sales-demo/videos/abc/v2/play.mp4";
    const { url, expiresAt } = await s3Driver.presignGet(key, 4 * 3600);
    const u = new URL(url);
    expect(`${u.origin}${u.pathname}`).toBe(`https://d111111abcdef8.cloudfront.net/${key}`);
    expect(u.searchParams.get("Key-Pair-Id")).toBe("K2TESTKEYID");
    const expires = Number(u.searchParams.get("Expires"));
    expect(expires * 1000).toBe(expiresAt.getTime());
    expect(expires).toBeGreaterThanOrEqual(Math.floor(Date.now() / 1000) + 4 * 3600 - 2);

    // CloudFront "canned policy" signature: RSA-SHA1 over the policy, URL-safe base64 (+→- =→_ /→~)
    const policy = JSON.stringify({ Statement: [{ Resource: `https://d111111abcdef8.cloudfront.net/${key}`, Condition: { DateLessThan: { "AWS:EpochTime": expires } } }] });
    const sig = Buffer.from(u.searchParams.get("Signature")!.replace(/-/g, "+").replace(/_/g, "=").replace(/~/g, "/"), "base64");
    expect(createVerify("RSA-SHA1").update(policy).verify(publicKey, sig)).toBe(true);

    // still refuses keys outside the app's folder
    await expect(s3Driver.presignGet("other-app/file.mp4", 60)).rejects.toMatchObject({ statusCode: 400 });
  });
});
