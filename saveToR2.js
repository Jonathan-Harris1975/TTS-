import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  }
});

export async function saveToR2(filename, fileBuffer) {
  const uploadParams = {
    Bucket: process.env.R2_BUCKET_NAME,
    Key: filename,
    Body: fileBuffer,
    ContentType: 'audio/mpeg'
  };

  await s3.send(new PutObjectCommand(uploadParams));

  return `${process.env.R2_PUBLIC_BASE_URL}/${filename}`;
}
