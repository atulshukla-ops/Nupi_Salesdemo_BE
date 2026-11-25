import env from "../configs/env";
import { localDriver } from "./localStorage.driver";
import { StorageDriver } from "./storage.types";

/** The active storage driver, chosen by STORAGE_DRIVER. */
export const storage = (): StorageDriver => {
  if (env.storageDriver === "local") return localDriver;
  // The S3 driver is added when the AWS bucket/CloudFront setup is approved and ready.
  throw new Error(`STORAGE_DRIVER=${env.storageDriver} is not available yet; use "local"`);
};

/** Object keys for an asset. The version is part of the path so a replaced file never hits a stale cache. */
export const assetKeys = (assetId: string, version: number, ext: string) => {
  const base = `${env.storagePrefix}/videos/${assetId}/v${version}`;
  return {
    original: `${base}/original.${ext}`,
    playback: `${base}/play.mp4`,
    thumbnail: `${base}/thumb.jpg`
  };
};

export const assetPrefix = (assetId: string) => `${env.storagePrefix}/videos/${assetId}/`;

/** One version's folder. The trailing slash matters on S3: "v1" alone would also match v10, v11, ... */
export const versionPrefix = (assetId: string, version: number) => `${assetPrefix(assetId)}v${version}/`;
