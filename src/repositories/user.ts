import { prisma } from '../lib/prisma.js';

export function getUserFull(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    include: { profile: true, lifestyle: true, dealBreakers: true, verifications: true },
  });
}
