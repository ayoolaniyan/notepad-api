import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// OWASP-recommended scrypt parameters (N=2^15, r=8, p=3), ~32 MiB per hash.
// Parameters are stored in the hash so they can be raised later without breaking old hashes.
const N = 2 ** 15;
const R = 8;
const P = 3;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

function deriveKey(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        scrypt(password, salt, KEY_LENGTH, { N: n, r, p, maxmem: 256 * n * r }, (err, key) => {
            if (err) reject(err);
            else resolve(key);
        });
    });
}

// Format: scrypt$<N>$<r>$<p>$<salt b64>$<hash b64>
export async function hashPassword(password: string): Promise<string> {
    const salt = randomBytes(SALT_LENGTH);
    const key = await deriveKey(password, salt, N, R, P);
    return ["scrypt", N, R, P, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
    const [algorithm, n, r, p, salt, hash] = stored.split("$");
    if (algorithm !== "scrypt" || !salt || !hash) return false;

    const expected = Buffer.from(hash, "base64");
    const key = await deriveKey(password, Buffer.from(salt, "base64"), Number(n), Number(r), Number(p));
    return key.length === expected.length && timingSafeEqual(key, expected);
}

// Used when a login email doesn't exist, so response timing doesn't reveal which emails are registered.
// Computed eagerly at startup so the first unknown-email login isn't slower than the rest.
const dummyHash = hashPassword("dummy-password-for-timing");
export async function burnPasswordCheck(password: string): Promise<void> {
    await verifyPassword(password, await dummyHash);
}
