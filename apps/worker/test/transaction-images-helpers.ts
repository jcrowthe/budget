import { env } from "cloudflare:test";
import { authed, call } from "./helpers";

const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

/** Tiny valid files, built in code. */
export const PNG = b64(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
);
export const JPEG = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9,
]);
export const GIF = ascii("GIF89a\x01\x00\x01\x00\x00\x00\x00;");
export const WEBP = ascii("RIFF\x0c\x00\x00\x00WEBPVP8 ");
export const AVIF = ascii("\x00\x00\x00\x1cftypavif\x00\x00\x00\x00avifmif1");
export const SVG = ascii(
  '<?xml version="1.0"?>\n<!-- c -->\n<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
);
export const TEXT = ascii("this is not an image");

export const imagesUrl = (b: string, t: string) => `/api/v1/budgets/${b}/transactions/${t}/image`;

export function multipart(bytes: Uint8Array, type: string, name = "receipt.png"): FormData {
  const form = new FormData();
  form.set("file", new File([bytes], name, { type }));
  return form;
}

export async function put(
  b: string,
  t: string,
  bytes: Uint8Array,
  type = "image/png",
  name?: string,
) {
  return call(imagesUrl(b, t), await authed({ method: "PUT", body: multipart(bytes, type, name) }));
}

export async function getImage(b: string, t: string, headers: Record<string, string> = {}) {
  return call(imagesUrl(b, t), await authed({ headers }));
}

export async function del(b: string, t: string) {
  return call(imagesUrl(b, t), await authed({ method: "DELETE" }));
}

export const objects = async () =>
  (await env.FILES.list({ prefix: "transaction-images/" })).objects;

export const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
