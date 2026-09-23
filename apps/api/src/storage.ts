import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Config } from './config.js';

export function createStorage(config: Config) {
  const options = {
    region: config.S3_REGION,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY }
  };
  const client = new S3Client({ ...options, endpoint: config.S3_ENDPOINT });
  const publicClient = new S3Client({ ...options, endpoint: config.S3_PUBLIC_ENDPOINT });

  return {
    createUploadUrl(objectKey: string, contentType: string) {
      return getSignedUrl(
        publicClient,
        new PutObjectCommand({ Bucket: config.S3_BUCKET, Key: objectKey, ContentType: contentType }),
        { expiresIn: 300 }
      );
    },
    createDownloadUrl(objectKey: string, fileName: string) {
      return getSignedUrl(
        publicClient,
        new GetObjectCommand({
          Bucket: config.S3_BUCKET,
          Key: objectKey,
          ResponseContentDisposition: `attachment; filename="${fileName.replace(/["\\\r\n]/g, '_')}"`
        }),
        { expiresIn: 300 }
      );
    },
    async getMetadata(objectKey: string) {
      const result = await client.send(new HeadObjectCommand({ Bucket: config.S3_BUCKET, Key: objectKey }));
      return { sizeBytes: result.ContentLength ?? 0, contentType: result.ContentType ?? 'application/octet-stream' };
    }
  };
}
