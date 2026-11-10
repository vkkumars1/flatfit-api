import type { Server, Socket } from 'socket.io';
import { verifyAccess } from '../lib/jwt.js';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';

let ioRef: Server | null = null;

async function isMember(matchId: string, userId: string): Promise<boolean> {
  const m = await prisma.match.findUnique({ where: { id: matchId } });
  return !!m && (m.userA === userId || m.userB === userId);
}

export function attachSockets(io: Server): void {
  ioRef = io;

  io.use((socket, next) => {
    try {
      const token = (socket.handshake.auth as any)?.token || socket.handshake.query?.token;
      if (!token) return next(new Error('unauthorised'));
      const payload = verifyAccess(String(token));
      (socket as any).userId = payload.sub;
      next();
    } catch { next(new Error('unauthorised')); }
  });

  io.on('connection', (socket: Socket) => {
    const userId = (socket as any).userId as string;
    socket.join(`user:${userId}`);
    logger.info({ userId }, 'socket connected');

    socket.on('typing', async ({ matchId }: { matchId: string }) => {
      if (!(await isMember(matchId, userId))) return;
      const match = await prisma.match.findUnique({ where: { id: matchId } });
      if (!match) return;
      const otherId = match.userA === userId ? match.userB : match.userA;
      io.to(`user:${otherId}`).emit('typing', { matchId, userId });
    });

    socket.on('read', async ({ matchId }: { matchId: string }) => {
      if (!(await isMember(matchId, userId))) return;
      await prisma.message.updateMany({ where: { matchId, senderId: { not: userId }, readAt: null }, data: { readAt: new Date() } });
      const match = await prisma.match.findUnique({ where: { id: matchId } });
      if (!match) return;
      const otherId = match.userA === userId ? match.userB : match.userA;
      io.to(`user:${otherId}`).emit('read', { matchId, by: userId });
    });

    socket.on('disconnect', () => logger.info({ userId }, 'socket disconnected'));
  });
}

export function emitMessage(toUserId: string, message: any): void {
  if (!ioRef) return;
  ioRef.to(`user:${toUserId}`).emit('message', message);
}

export function emitMatchEvent(aUserId: string, bUserId: string, matchId: string): void {
  if (!ioRef) return;
  ioRef.to(`user:${aUserId}`).emit('match', { matchId, with: bUserId });
  ioRef.to(`user:${bUserId}`).emit('match', { matchId, with: aUserId });
}
