const enc = new TextEncoder();
const dec = new TextDecoder();

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** The key is base64 of exactly 32 bytes (AES-256). */
export async function importKey(b64: string): Promise<CryptoKey> {
  let raw: Uint8Array;
  try {
    raw = fromBase64(b64.trim());
  } catch {
    throw new Error("Encryption key is not valid base64");
  }
  if (raw.byteLength !== 32) throw new Error("Encryption key must be exactly 32 bytes");
  return crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
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
