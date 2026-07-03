import { randomUUID } from 'node:crypto';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from './config.js';

/** Hard ceiling on a stored blob (ciphertext). 50 MB plaintext + AEAD/format overhead. */
export const MAX_BLOB_BYTES = 55 * 1024 * 1024;

/**
 * S3-compatible object storage (MinIO in dev). The app server never proxies file
 * bytes — clients PUT/GET encrypted blobs DIRECTLY via short-lived presigned URLs.
 * The bytes stored here are always ciphertext (the per-file key lives in the E2EE
 * message, never here).
 */
const s3 = new S3Client({
  endpoint: config.S3_ENDPOINT,
  region: config.S3_REGION,
  forcePathStyle: config.S3_FORCE_PATH_STYLE,
  credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
});

const PRESIGN_TTL_SECONDS = 300; // 5 minutes

/** Generate an opaque, collision-resistant object key for a new blob. */
export function newBlobKey(): string {
  return `att/${randomUUID()}`;
}

export function presignUpload(blobKey: string): Promise<string> {
  return getSignedUrl(s3, new PutObjectCommand({ Bucket: config.S3_BUCKET, Key: blobKey }), {
    expiresIn: PRESIGN_TTL_SECONDS,
  });
}

export function presignDownload(blobKey: string): Promise<string> {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: blobKey }), {
    expiresIn: PRESIGN_TTL_SECONDS,
  });
}

/**
 * Actual stored size of a blob (bytes), or null if it doesn't exist. Presigned PUT
 * can't enforce a size limit at upload time, so callers HEAD the object before
 * accepting it (e.g. attaching to a message) to enforce {@link MAX_BLOB_BYTES}.
 */
export async function objectSize(blobKey: string): Promise<number | null> {
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: config.S3_BUCKET, Key: blobKey }));
    return head.ContentLength ?? null;
  } catch {
    return null;
  }
}
