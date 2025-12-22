// Generate PBKDF2 password hash for seed data
const ITERATIONS = 100000;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const derivedKey = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    KEY_LENGTH * 8
  );

  const saltBase64 = btoa(String.fromCharCode(...salt));
  const hashBase64 = btoa(String.fromCharCode(...new Uint8Array(derivedKey)));
  return `${saltBase64}:${hashBase64}`;
}

const password = process.argv[2] || '123456';
hashPassword(password).then(hash => {
  console.log(`Password: ${password}`);
  console.log(`Hash: ${hash}`);
});
