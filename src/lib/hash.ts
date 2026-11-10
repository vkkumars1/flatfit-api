import bcrypt from 'bcryptjs';

// why: 10 rounds is CPU-cheap enough for OTP/refresh-token hashes at scale.
const ROUNDS = 10;

export const hash = (plain: string) => bcrypt.hash(plain, ROUNDS);
export const verifyHash = (plain: string, hashed: string) => bcrypt.compare(plain, hashed);
