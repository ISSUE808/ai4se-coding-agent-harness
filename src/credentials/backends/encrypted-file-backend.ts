import {
  createCipheriv,
  createDecipheriv,
  pbkdf2Sync,
  randomBytes,
} from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { CredentialBackend } from '../../types.js';

/**
 * EncryptedFileBackend — AES-256-GCM encrypted file fallback (SPEC §3.7).
 *
 * The whole secret map is serialized, encrypted with a key derived from the
 * master password via PBKDF2-SHA256 (100k iterations, SPEC §4.2), and written
 * to `~/.codeharness/secrets.enc`. A wrong password fails AES-GCM tag
 * verification during decryption.
 */
const ALGORITHM = 'aes-256-gcm';
const PBKDF2_ITERATIONS = 100_000;
const KEY_LENGTH = 32; // AES-256

interface EncryptedPayload {
  version: 1;
  salt: string; // base64
  iv: string; // base64
  tag: string; // base64
  ciphertext: string; // base64
}

type SecretMap = Record<string, Record<string, string>>;

export class EncryptedFileBackend implements CredentialBackend {
  readonly name = 'encrypted-file';
  private readonly password: string;
  private readonly filePath: string;

  constructor(
    password: string,
    filePath: string = join(homedir(), '.codeharness', 'secrets.enc'),
  ) {
    if (!password) {
      throw new Error('EncryptedFileBackend requires a master password');
    }
    this.password = password;
    this.filePath = filePath;
  }

  /** Pure-stdlib crypto, always available. */
  async isAvailable(): Promise<boolean> {
    return true;
  }

  async save(service: string, account: string, secret: string): Promise<void> {
    const map = this.loadMap();
    (map[service] ??= {})[account] = secret;
    this.writeMap(map);
  }

  async read(service: string, account: string): Promise<string | null> {
    const map = this.loadMap();
    return map[service]?.[account] ?? null;
  }

  async delete(service: string, account: string): Promise<boolean> {
    const map = this.loadMap();
    if (!map[service] || !(account in map[service])) {
      return false;
    }
    delete map[service][account];
    if (Object.keys(map[service]).length === 0) {
      delete map[service];
    }
    this.writeMap(map);
    return true;
  }

  async exists(service: string, account: string): Promise<boolean> {
    const map = this.loadMap();
    return Boolean(map[service] && account in map[service]);
  }

  private loadMap(): SecretMap {
    let raw: string;
    try {
      raw = readFileSync(this.filePath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return {};
      }
      throw err;
    }
    return this.decryptMap(JSON.parse(raw) as EncryptedPayload);
  }

  private writeMap(map: SecretMap): void {
    const payload = this.encryptMap(map);
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(payload, null, 2), {
      mode: 0o600,
    });
  }

  private deriveKey(salt: Buffer): Buffer {
    return pbkdf2Sync(this.password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');
  }

  private encryptMap(map: SecretMap): EncryptedPayload {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = this.deriveKey(salt);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(map), 'utf8'),
      cipher.final(),
    ]);
    return {
      version: 1,
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
  }

  private decryptMap(payload: EncryptedPayload): SecretMap {
    const key = this.deriveKey(Buffer.from(payload.salt, 'base64'));
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(payload.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, 'base64')),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString('utf8')) as SecretMap;
  }
}
