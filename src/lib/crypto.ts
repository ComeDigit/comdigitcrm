import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";
import { env } from "@/lib/env";

/**
 * AES-256-GCM envelope encryption for integration credentials at rest.
 * Key: APP_ENCRYPTION_KEY (32+ chars, hashed to 32 bytes). Output format:
 * v1.<iv b64>.<tag b64>.<ciphertext b64> — versioned for future rotation.
 * Used by the connector callbacks before anything touches the database;
 * plaintext tokens never leave process memory.
 */

function key(): Buffer {
  if (!env.APP_ENCRYPTION_KEY) {
    throw new Error("APP_ENCRYPTION_KEY is not set — cannot handle credentials.");
  }
  return createHash("sha256").update(env.APP_ENCRYPTION_KEY).digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64")}.${tag.toString("base64")}.${ciphertext.toString("base64")}`;
}

export function decryptSecret(payload: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split(".");
  if (version !== "v1" || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("Unrecognized secret payload format");
  }
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
