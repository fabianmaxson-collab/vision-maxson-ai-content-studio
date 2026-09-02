import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

export interface AccessIdentity {
  issuer: string;
  subject: string;
  email: string;
  issuedAt?: number;
  expiresAt?: number;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeTeamDomain(teamDomain: string): string {
  return teamDomain.replace(/\/+$/, '');
}

export async function verifyAccessJwt(
  token: string,
  teamDomain: string,
  audience: string,
): Promise<AccessIdentity> {
  const issuer = normalizeTeamDomain(teamDomain);
  const jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
  const { payload } = await jwtVerify(token, jwks, { issuer, audience });
  return identityFromPayload(payload, issuer);
}

export function identityFromPayload(payload: JWTPayload, issuer: string): AccessIdentity {
  if (!payload.sub || typeof payload.email !== 'string')
    throw new Error('Access JWT lacks a stable subject or email');
  return {
    issuer,
    subject: payload.sub,
    email: normalizeEmail(payload.email),
    ...(payload.iat === undefined ? {} : { issuedAt: payload.iat }),
    ...(payload.exp === undefined ? {} : { expiresAt: payload.exp }),
  };
}

function bytesToBase64(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function importKey(encodedKey: string): Promise<CryptoKey> {
  const raw = base64ToBytes(encodedKey);
  if (raw.byteLength !== 32)
    throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes encoded as base64');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptSecret(
  plaintext: string,
  encodedKey: string,
  context: string,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importKey(encodedKey);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(context) },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `v1.${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(ciphertext))}`;
}

export async function decryptSecret(
  envelope: string,
  encodedKey: string,
  context: string,
): Promise<string> {
  const [version, iv, ciphertext] = envelope.split('.');
  if (version !== 'v1' || !iv || !ciphertext)
    throw new Error('Unsupported encrypted secret envelope');
  const key = await importKey(encodedKey);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(iv), additionalData: new TextEncoder().encode(context) },
    key,
    base64ToBytes(ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}
