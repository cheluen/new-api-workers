import type { JwtPayload } from '../types';

interface JwtHeader {
  alg: string;
  typ: string;
}

function base64UrlEncode(data: Uint8Array): string {
  let base64 = '';
  const bytes = new Uint8Array(data);
  for (let i = 0; i < bytes.length; i++) {
    base64 += String.fromCharCode(bytes[i]);
  }
  return btoa(base64).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str: string): Uint8Array {
  const padded = str + '='.repeat((4 - (str.length % 4)) % 4);
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function encodeJSON(obj: object): string {
  const encoder = new TextEncoder();
  return base64UrlEncode(encoder.encode(JSON.stringify(obj)));
}

function decodeJSON<T>(str: string): T {
  const decoder = new TextDecoder();
  return JSON.parse(decoder.decode(base64UrlDecode(str)));
}

async function getSigningKey(secret: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function signJwt(
  payload: Omit<JwtPayload, 'iat' | 'exp'>,
  secret: string,
  expiryHours: number = 24
): Promise<string> {
  const header: JwtHeader = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);

  const fullPayload: JwtPayload = {
    ...payload,
    iat: now,
    exp: now + expiryHours * 3600,
  };

  const headerEncoded = encodeJSON(header);
  const payloadEncoded = encodeJSON(fullPayload);
  const data = `${headerEncoded}.${payloadEncoded}`;

  const key = await getSigningKey(secret);
  const encoder = new TextEncoder();
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));

  return `${data}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export async function verifyJwt(
  token: string,
  secret: string
): Promise<JwtPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }

  const [headerEncoded, payloadEncoded, signatureEncoded] = parts;
  const data = `${headerEncoded}.${payloadEncoded}`;

  try {
    const key = await getSigningKey(secret);
    const encoder = new TextEncoder();
    const signature = base64UrlDecode(signatureEncoded);

    const isValid = await crypto.subtle.verify(
      'HMAC',
      key,
      signature,
      encoder.encode(data)
    );

    if (!isValid) {
      return null;
    }

    const payload = decodeJSON<JwtPayload>(payloadEncoded);
    const now = Math.floor(Date.now() / 1000);

    if (payload.exp < now) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export function decodeJwt(token: string): JwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }

  try {
    return decodeJSON<JwtPayload>(parts[1]);
  } catch {
    return null;
  }
}
