
/**
 * Compares the strings in UTF-8 binary order. This is the supposed to
 * be the same order as S3 returns.
 */
export function compareStringsUtf8BinaryOrder(a: string, b: string) {
  return Buffer.compare(Buffer.from(a, 'utf-8'), Buffer.from(b, 'utf-8'));
}
