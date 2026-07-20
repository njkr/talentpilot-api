import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Env } from 'src/config/config.module';

@Injectable()
export class StorageService implements OnModuleInit {
  private client: S3Client;
  private bucket: string;

  constructor(private readonly env: Env) {}

  onModuleInit() {
    this.bucket = this.env.get('S3_BUCKET');
    this.client = new S3Client({
      region: this.env.get('S3_REGION'),
      endpoint: this.env.get('S3_ENDPOINT'), // undefined → real AWS
      forcePathStyle: this.env.get('S3_FORCE_PATH_STYLE'), // MinIO: true
      credentials: {
        accessKeyId: this.env.get('S3_ACCESS_KEY'),
        secretAccessKey: this.env.get('S3_SECRET_KEY'),
      },
    });
  }

  /**
   * Key scheme:  users/{userId}/resumes/{resumeId}/original.{ext}
   *
   * Three deliberate properties:
   *  1. The user id is in the path → a leaked key from user A can't be guessed into user B's file.
   *  2. The filename is SERVER-generated. Never put the user's filename in the path: it enables
   *     path traversal ("../../etc/passwd"), null-byte tricks, and unicode confusables.
   *  3. Prefixed by user → GDPR deletion is one `deletePrefix('users/{id}/')` call.
   */
  resumeKey(userId: string, resumeId: string, ext: string) {
    return `users/${userId}/resumes/${resumeId}/original.${ext}`;
  }

  async put(key: string, body: Buffer, contentType: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        // Real S3/R2: yes. Plain MinIO: rejects this with "NotImplemented" unless a
        // KMS backend is configured — see S3_SERVER_SIDE_ENCRYPTION.
        ...(this.env.get('S3_SERVER_SIDE_ENCRYPTION') && {
          ServerSideEncryption: 'AES256' as const,
        }),
      }),
    );
    return key;
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return Buffer.from(await res.Body!.transformToByteArray());
  }

  /**
   * The API NEVER streams file bytes to the client. It returns a short-lived signed URL and
   * the browser fetches from S3 directly. Streaming through Node would pin memory per download
   * and make your API the bandwidth bottleneck for something S3 does better and cheaper.
   */
  async getSignedUrl(key: string, filename?: string) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        // Forces a download with a friendly name instead of rendering in-browser.
        ...(filename && {
          ResponseContentDisposition: `attachment; filename="${encodeURIComponent(filename)}"`,
        }),
      }),
      { expiresIn: this.env.get('SIGNED_URL_TTL_SEC') },
    );
  }

  async delete(key: string) {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  /** Used by the GDPR purge job (later sprint). S3 has no "delete folder" — you list, then batch. */
  async deletePrefix(prefix: string) {
    let token: string | undefined;
    do {
      const list = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      );
      if (list.Contents?.length) {
        await this.client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: { Objects: list.Contents.map((o) => ({ Key: o.Key! })) },
          }),
        );
      }
      token = list.NextContinuationToken;
    } while (token);
  }
}
