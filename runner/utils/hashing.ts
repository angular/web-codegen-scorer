import {createHash} from 'node:crypto';

/**
 * Returns a sha-256 hash of a string.
 */
export function getSha256Hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
