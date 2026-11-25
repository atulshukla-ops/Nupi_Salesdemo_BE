import env from "../configs/env";
import { localDriver } from "./localStorage.driver";
import { s3Driver } from "./s3Storage.driver";
import { StorageDriver } from "./storage.types";

/** The active storage driver, chosen by STORAGE_DRIVER. */
export const storage = (): StorageDriver => {
  if (env.storageDriver === "local") return localDriver;
  if (env.storageDriver === "s3") return s3Driver;
  throw new Error(`Unknown STORAGE_DRIVER=${env.storageDriver}; use "local" or "s3"`);
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
