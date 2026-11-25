/**
 * What the app needs from file storage. Two implementations:
 *  - local: files on this machine (development), served by our own signed endpoints
 *  - s3:    AWS S3 multipart uploads + presigned URLs (added when the AWS bucket is ready)
 * The browser only ever sees signed URLs, so switching driver does not change the frontend.
 */
export interface UploadedPart {
  partNumber: number;
  etag: string;
  size: number;
}

export interface StorageDriver {
  readonly name: "local" | "s3";
  createMultipartUpload(key: string, mimeType: string): Promise<{ uploadId: string }>;
  /** URL the browser PUTs one part's bytes to. The response carries the part's ETag header. */
  presignUploadPart(key: string, uploadId: string, partNumber: number, expiresInSec: number): Promise<string>;
  listParts(key: string, uploadId: string): Promise<UploadedPart[]>;
  completeMultipartUpload(key: string, uploadId: string, parts: { partNumber: number; etag: string }[]): Promise<void>;
  abortMultipartUpload(key: string, uploadId: string): Promise<void>;
  headObject(key: string): Promise<{ size: number } | null>;
  /**
   * Time-limited URL to read a file (playback, thumbnails). Valid for at least expiresInSec;
   * with alignSec the expiry is rounded up to that boundary so repeated calls return the same URL.
   */
  presignGet(key: string, expiresInSec: number, alignSec?: number): Promise<{ url: string; expiresAt: Date }>;
  /** Removes every object under a prefix, e.g. all versions of one asset. */
  deletePrefix(prefix: string): Promise<void>;
  /** Worker side: copy an object to a local file for ffmpeg, and store a produced file. */
  downloadToFile(key: string, destination: string): Promise<void>;
  uploadFromFile(source: string, key: string, contentType: string): Promise<void>;
}
