/**
 * A stand-in for an mtcute session string: base64url like the real one, long enough that its
 * fragments are distinctive. It is not a real session (no account, no auth key).
 */
export const FAKE_SESSION =
  'AwAAAAEXAQAAAAEAAAAAAAAAAACGTEstSeSsIoNsTrInGnOtArEaLoNe_9f8e7d6c5b4a39281706f5e4d3c2b1a0' +
  'ZmFrZS1hdXRoLWtleS1mb3ItdGVzdHMtb25seS1uZXZlci1hLXJlYWwtYWNjb3VudC0wMTIzNDU2Nzg5YWJjZGVm';

/**
 * Pieces of a secret to look for in output: the whole value plus every 16-character window at a
 * stride of 8, so a log line holding part of the secret (a truncated or wrapped copy) is caught too.
 */
export function secretFragments(secret: string): string[] {
  const out = [secret];
  for (let i = 0; i + 16 <= secret.length; i += 8) out.push(secret.slice(i, i + 16));
  return out;
}
