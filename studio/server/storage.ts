import { randomUUID } from 'node:crypto';
import { mkdir, open, unlink, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

export interface ObjectStorage {
  put(data: Uint8Array): Promise<{ key: string; size: number }>;
  get(key: string): Promise<Uint8Array>;
  remove(key: string): Promise<void>;
}

// No public upload/download routes until authentication and asset authorization exist.
// OSS will implement this contract; callers persist opaque keys, never local paths.
export class LocalObjectStorage implements ObjectStorage {
  constructor(private readonly directory: string) {}
  private filename(key: string) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        key,
      )
    ) {
      throw new Error('Invalid object key');
    }
    return path.join(this.directory, key);
  }
  async put(data: Uint8Array) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const key = randomUUID();
    await writeFile(this.filename(key), data, { flag: 'wx', mode: 0o600 });
    return { key, size: data.byteLength };
  }
  async get(key: string) {
    const file = await open(
      this.filename(key),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      if (!(await file.stat()).isFile())
        throw new Error('Object is not a regular file');
      return await file.readFile();
    } finally {
      await file.close();
    }
  }
  async remove(key: string) {
    await unlink(this.filename(key));
  }
}
