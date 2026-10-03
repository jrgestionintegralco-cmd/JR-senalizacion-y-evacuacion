import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Config } from './config.js';
import { createHash, randomUUID } from 'node:crypto';
import { PlanFileError, validatePlanBytes } from './plan-validation.js';

export function createStorage(config: Config) {
  const options = {
    region: config.S3_REGION,
    requestChecksumCalculation: 'WHEN_REQUIRED' as const,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY }
  };
  const client = new S3Client({ ...options, endpoint: config.S3_ENDPOINT });
  const publicClient = new S3Client({ ...options, endpoint: config.S3_PUBLIC_ENDPOINT });
  let activeValidations = 0;
  async function readBounded(key: string, expectedSize: number) {
    const result = await client.send(new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key }), { abortSignal: AbortSignal.timeout(30_000) });
    const body = result.Body as import('node:stream').Readable | undefined;
    if (!body || result.ContentLength !== expectedSize || expectedSize > config.MAX_UPLOAD_BYTES) {
      body?.destroy();
      throw new PlanFileError('SIZE_MISMATCH', 'El tamaño cargado no coincide con el registrado.', 409);
    }
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for await (const chunk of body) {
        size += chunk.length;
        if (size > expectedSize) throw new PlanFileError('SIZE_MISMATCH', 'El archivo supera el tamaño permitido.', 409);
        chunks.push(Buffer.from(chunk));
      }
    } finally { body.destroy(); }
    if (size !== expectedSize) throw new PlanFileError('SIZE_MISMATCH', 'El archivo está incompleto.', 409);
    return Buffer.concat(chunks);
  }

  return {
    createUploadUrl(objectKey: string, contentType: string, sizeBytes?: number) {
      return getSignedUrl(
        publicClient,
        new PutObjectCommand({ Bucket: config.S3_BUCKET, Key: objectKey, ContentType: contentType, ContentLength: sizeBytes }),
        { expiresIn: 300, signableHeaders: new Set(['content-type', ...(sizeBytes === undefined ? [] : ['content-length'])]) }
      );
    },
    createDownloadUrl(objectKey: string, fileName: string) {
      return getSignedUrl(
        publicClient,
        new GetObjectCommand({
          Bucket: config.S3_BUCKET,
          Key: objectKey,
          ResponseCacheControl: 'private, no-store, max-age=0',
          ResponseContentDisposition: `attachment; filename="${fileName.replace(/["\\\r\n]/g, '_')}"`
        }),
        { expiresIn: 300 }
      );
    },
    async finalizePlan(stagingKey: string, expectedSize: number, contentType: string, organizationId: string, floorId: string) {
      if (activeValidations >= 2) throw new PlanFileError('VALIDATION_BUSY', 'Hay archivos en verificación. Intenta confirmar de nuevo en unos segundos.', 503);
      activeValidations++;
      try {
        const bytes = await readBounded(stagingKey, expectedSize);
        await validatePlanBytes(bytes, contentType);
        const checksum = createHash('sha256').update(bytes).digest('hex');
        const objectKey = `${organizationId}/plans/${floorId}/sealed/${randomUUID()}`;
        // Only the server writes this fresh key. No upload URL ever targets it.
        await client.send(new PutObjectCommand({
          Bucket: config.S3_BUCKET, Key: objectKey, Body: bytes,
          ContentType: contentType, ContentLength: bytes.length,
          CacheControl: 'private, no-store, max-age=0', IfNoneMatch: '*',
          ChecksumSHA256: Buffer.from(checksum, 'hex').toString('base64'),
          Metadata: { sha256: checksum }
        }), { abortSignal: AbortSignal.timeout(30_000) });
        const persisted = await readBounded(objectKey, expectedSize);
        if (createHash('sha256').update(persisted).digest('hex') !== checksum) throw new Error('Final object checksum mismatch');
        return { objectKey, checksum };
      } finally { activeValidations--; }
    },
    async getMetadata(objectKey: string) {
      const result = await client.send(new HeadObjectCommand({ Bucket: config.S3_BUCKET, Key: objectKey }));
      return { sizeBytes: result.ContentLength ?? 0, contentType: result.ContentType ?? 'application/octet-stream' };
    }
  };
}
