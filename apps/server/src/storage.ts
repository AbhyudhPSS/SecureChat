import { randomUUID } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from './config.js';

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
