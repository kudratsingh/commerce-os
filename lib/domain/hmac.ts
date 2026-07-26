/**
 * HMAC-SHA256 signing + verification via Web Crypto.
 *
 * Works identically on:
 *   - Workers (workerd)      — `crypto.subtle` is a global
 *   - Node 22 route handlers — same Web Crypto shape
 *   - Vitest                 — same
 *
 * Signatures are hex-encoded to match TikTok Shop's real header convention.
 * `crypto.subtle.verify` performs constant-time comparison — never compare
 * signatures with `===`.
 */

const encoder = new TextEncoder();

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signBody(secret: string, body: string): Promise<string> {
  const key = await importKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return toHex(new Uint8Array(sig));
}

export async function verifySignature(
  secret: string,
  body: string,
  hexSignature: string,
): Promise<boolean> {
  if (!hexSignature || !/^[0-9a-fA-F]+$/.test(hexSignature)) return false;
  if (hexSignature.length % 2 !== 0) return false;
  const key = await importKey(secret);
  try {
    return await crypto.subtle.verify(
      "HMAC",
      key,
      fromHex(hexSignature) as BufferSource,
      encoder.encode(body),
    );
  } catch {
    return false;
  }
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

function fromHex(s: string): Uint8Array {
  const bytes = new Uint8Array(s.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
