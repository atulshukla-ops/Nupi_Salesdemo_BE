import { createHmac, timingSafeEqual } from "crypto";
import env from "../configs/env";

/** HMAC signatures for the local storage driver's URLs (stand-in for S3 presigned URLs). */
const key = () => createHmac("sha256", env.hostTokenSecret).update("local-storage-v1").digest();

export const sign = (payload: string) => createHmac("sha256", key()).update(payload).digest("base64url");

export const verify = (payload: string, signature: string, expiresAt: number) => {
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 < Date.now()) return false;
  const a = Buffer.from(sign(payload));
  const b = Buffer.from(signature || "");
  return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * Unix expiry time. With alignSec the expiry is rounded up to a fixed boundary, so the same URL is
 * handed out for a while and browsers can cache what it points to (e.g. thumbnails).
 */
export const expiry = (expiresInSec: number, alignSec?: number) => {
  const exp = Math.floor(Date.now() / 1000) + expiresInSec;
  return alignSec ? Math.ceil(exp / alignSec) * alignSec : exp;
};
