import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Config } from './config.js';

export function createStorage(config: Config) {
  const client = new S3Client({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY }
  });

  return {
    createUploadUrl(objectKey: string, contentType: string) {
      return getSignedUrl(
        client,
        new PutObjectCommand({ Bucket: config.S3_BUCKET, Key: objectKey, ContentType: contentType }),
        { expiresIn: 300 }
      );
    }
  };
}
