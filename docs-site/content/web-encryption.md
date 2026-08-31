There is nothing framework-specific here — Node's `node:crypto` is the whole toolkit, and [Directive 7](./anti-patterns.html) means no crypto library is a dependency. What this page covers is the choices that go wrong when encryption meets a database.

## Passwords: hash, never encrypt

```ts
import { scrypt as scryptCb, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, salt, expected] = stored.split('$');
  if (salt === undefined || expected === undefined) return false;
  const key = (await scrypt(password, Buffer.from(salt, 'base64'), 64)) as Buffer;
  const want = Buffer.from(expected, 'base64');
  return key.length === want.length && timingSafeEqual(key, want);
}
```

Encryption is reversible; a password store must not be. `scrypt` is in Node with no dependency; Argon2id is better if you are willing to add one. Never `sha256(password)` — a fast hash is brute-forceable at billions of guesses per second.

Store the algorithm and salt with the hash, as above, so you can migrate the parameters later without a flag day.

## Storing a column encrypted

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map(b => b.toString('base64')).join('.');
}

export function decrypt(packed: string, key: Buffer): string {
  const [iv, tag, body] = packed.split('.').map(p => Buffer.from(p, 'base64'));
  if (iv === undefined || tag === undefined || body === undefined) throw new Error('malformed ciphertext');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}
```

Four things that are not stylistic:

- **GCM, not CBC.** GCM authenticates: a tampered ciphertext fails on `final()` instead of decrypting to attacker-influenced plaintext.
- **A fresh random IV per encryption.** Reusing an IV with GCM is catastrophic — it leaks the plaintext relationship and can expose the authentication key. Never derive an IV from the row id.
- **Store the IV and tag with the ciphertext.** They are not secret; without them you cannot decrypt.
- **`decipher.final()` throws on tampering.** Let it. Catching and returning a default silently accepts corrupted data.

## Where the encryption happens

Encrypt in your service before `create`/`update`, and decrypt after reading:

```ts
async function store(dto: { ssn: string }) {
  return this.repo.create({ ssnEncrypted: encrypt(dto.ssn, key) });
}
```

There is no `@Encrypted()` column decorator and no transparent column transform. That is a genuine gap — the [`postSelect` hook](./lifecycle-hooks.html) can decrypt on the way out, but there is no matching transform on the way in that covers `create`, `update` and the query builder uniformly.

> [!WARNING]
> An encrypted column cannot be queried. `where('ssn', '=', value)` compares
> ciphertexts, and with a random IV the same plaintext encrypts differently every
> time — so equality never matches. If you must look a value up, store a separate
> deterministic HMAC of it (`hmac(value, indexKey)`) and query that. Accept that a
> deterministic index leaks equality: identical values produce identical hashes.

Ordering, `LIKE` and ranges are gone entirely. Design around it before encrypting a column you filter on.

## Key management

The part that decides whether any of this helps.

- **Never in the repository, never in the image.** Use a KMS, or an environment variable populated from a secret store.
- **Not the same key as your JWT signing key.** Separate keys for separate purposes limits the blast radius.
- **Store a key id with the ciphertext** (`v2.iv.tag.body`) so you can rotate. Without it, rotation means decrypting everything with a key you have to keep forever.
- **A key derived from a password needs a KDF**, not a hash: `scrypt(passphrase, salt, 32)`, not `sha256(passphrase)`.

If the encryption key sits in the same environment as the database credentials, encryption at the application layer buys you very little over the database's own at-rest encryption. Be clear about which threat you are addressing.

## Tokens and comparisons

```ts
const token = randomBytes(32).toString('base64url');
```

`randomBytes`, never `Math.random()` — the latter is predictable and has been the root cause of many session-prediction vulnerabilities.

Store a hash of the token, not the token, so a database leak does not hand over live credentials. Compare with `timingSafeEqual` after a length check; `===` short-circuits and leaks the value byte by byte.

## What not to log

Never log a key, a token, a password, a ciphertext, or query parameters — parameters are where encrypted values and credentials travel. Log parameter _types_ if you need shape information. See [Logging](./logging.html).

---

See also: [Authentication](./web-authentication.html) · [Logging](./logging.html) · [Repository Hooks](./lifecycle-hooks.html)
