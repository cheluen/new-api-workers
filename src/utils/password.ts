const ITERATIONS = 100000;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

async function deriveKey(
  password: string,
  salt: Uint8Array
): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  return crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    KEY_LENGTH * 8
  );
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const derivedKey = await deriveKey(password, salt);
  const saltBase64 = arrayBufferToBase64(salt.buffer as ArrayBuffer);
  const hashBase64 = arrayBufferToBase64(derivedKey);
  return `${saltBase64}:${hashBase64}`;
}

export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<boolean> {
  const [saltBase64, hashBase64] = storedHash.split(':');
  if (!saltBase64 || !hashBase64) {
    return false;
  }

  const salt = base64ToArrayBuffer(saltBase64);
  const storedKey = base64ToArrayBuffer(hashBase64);
  const derivedKey = await deriveKey(password, salt);
  const derivedBytes = new Uint8Array(derivedKey);

  if (storedKey.length !== derivedBytes.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < storedKey.length; i++) {
    result |= storedKey[i] ^ derivedBytes[i];
  }
  return result === 0;
}
