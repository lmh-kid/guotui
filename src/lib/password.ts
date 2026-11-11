import { randomBytes, scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);

const KEY_LEN = 64;

/**
 * 生成密码哈希。格式：scrypt$<salt hex>$<hash hex>
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scryptAsync(password, salt, KEY_LEN)) as Buffer;
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

/**
 * 校验密码（恒定时间比较，防时序攻击）
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [algo, saltHex, hashHex] = stored.split('$');
    if (algo !== 'scrypt' || !saltHex || !hashHex) return false;
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const derived = (await scryptAsync(password, salt, expected.length)) as Buffer;
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}
