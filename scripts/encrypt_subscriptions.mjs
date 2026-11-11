// Usage: PASS=... node scripts/encrypt_subscriptions.mjs in.json subscriptions.enc.json
//
// Encrypts a JSON payload to the envelope the SUBSCRIPTIONS tab decrypts
// in the browser (PBKDF2-SHA256 → AES-256-GCM). Never commit the plaintext
// input; only the .enc.json envelope belongs in this public repo.
import { webcrypto as c } from 'node:crypto';
import fs from 'node:fs';

const [, , inp, out] = process.argv;
const pass = process.env.PASS;
if (!pass) throw new Error('PASS env missing');
if (!inp || !out) throw new Error('usage: PASS=... node scripts/encrypt_subscriptions.mjs in.json out.enc.json');

const data = fs.readFileSync(inp);
const salt = c.getRandomValues(new Uint8Array(16));
const iv = c.getRandomValues(new Uint8Array(12));
const iter = 600000;
const base = await c.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
const key = await c.subtle.deriveKey(
  { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter },
  base,
  { name: 'AES-GCM', length: 256 },
  false,
  ['encrypt']
);
const ct = new Uint8Array(await c.subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
const b64 = (u) => Buffer.from(u).toString('base64');
fs.writeFileSync(out, JSON.stringify({
  v: 1,
  kdf: 'PBKDF2-SHA256',
  iter,
  cipher: 'AES-256-GCM',
  salt: b64(salt),
  iv: b64(iv),
  ct: b64(ct)
}));
console.log('wrote', out);
