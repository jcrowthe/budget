const enc = new TextEncoder();
const dec = new TextDecoder();

export const MIN_KEY_CHARS = 32;
/** Fixed forever; key versioning goes in `info`. */
export const HKDF_SALT = "budget-secrets-salt";
export const keyInfo = (version: number) => `budget-secrets-v${version}`;

/** The message is fixed: it never carries the value or its length. */
export class KeyTooShort extends Error {
  constructor() {
    super("SECRETS_ENCRYPTION_KEY must be at least 32 characters");
    this.name = "KeyTooShort";
  }
}

/**
 * The key is any string of at least 32 characters; HKDF derives the AES-256 key per key version:
 * AES-256-GCM key = HKDF-SHA-256(utf8(secret.trim()), salt = HKDF_SALT, info = keyInfo(version)).
 */
export async function deriveKey(secret: string, version: number): Promise<CryptoKey> {
  const material = secret.trim();
  if (material.length < MIN_KEY_CHARS) throw new KeyTooShort();
  const base = await crypto.subtle.importKey("raw", enc.encode(material), "HKDF", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: enc.encode(HKDF_SALT),
      info: enc.encode(keyInfo(version)),
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Random 96-bit IV per record; the record name is the additional authenticated data. */
export async function seal(key: CryptoKey, name: string, text: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: enc.encode(name) },
    key,
    enc.encode(text),
  );
  return { ciphertext: new Uint8Array(ct), iv };
}

export async function open(
  key: CryptoKey,
  name: string,
  ciphertext: Uint8Array,
  iv: Uint8Array,
): Promise<string> {
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource, additionalData: enc.encode(name) },
    key,
    ciphertext as BufferSource,
  );
  return dec.decode(pt);
}
