import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { stripHtml } from '../lib/sanitize.js';
import { NotFound, Forbidden } from '../lib/errors.js';

export async function listListings(req: Request, res: Response, next: NextFunction) {
  try {
    const { city, min, max, verified, cursor } = req.query as any;
    const where: any = {};
    if (city) where.city = city;
    if (min || max) where.rent = { ...(min ? { gte: Number(min) } : {}), ...(max ? { lte: Number(max) } : {}) };
    if (verified !== undefined) where.verified = verified === 'true' || verified === true;
    const items = await prisma.listing.findMany({
      where, orderBy: { createdAt: 'desc' }, take: 20,
      ...(cursor ? { skip: 1, cursor: { id: String(cursor) } } : {}),
    });
    const nextCursor = items.length === 20 ? items[items.length - 1]?.id : null;
    res.json({ items, nextCursor });
  } catch (e) { next(e); }
}

export async function getListing(req: Request, res: Response, next: NextFunction) {
  try {
    const row = await prisma.listing.findUnique({ where: { id: req.params.id! } });
    if (!row) throw NotFound('Listing not found');
    res.json(row);
  } catch (e) { next(e); }
}

export async function createListing(req: Request, res: Response, next: NextFunction) {
  try {
    const u = (req as any).user;
    const body = req.body as any;
    const row = await prisma.listing.create({
      data: {
        ownerId: u.id,
        title: stripHtml(body.title),
        city: body.city,
        locality: body.locality,
        rent: body.rent,
        deposit: body.deposit ?? 0,
        bills: body.bills ?? 0,
        description: stripHtml(body.description ?? ''),
        photos: body.photos ?? [],
        amenities: body.amenities ?? [],
        availableFrom: new Date(body.availableFrom),
      },
    });
    res.json(row);
  } catch (e) { next(e); }
}

export async function updateListing(req: Request, res: Response, next: NextFunction) {
  try {
    const u = (req as any).user;
    const row = await prisma.listing.findUnique({ where: { id: req.params.id! } });
    if (!row) throw NotFound('Listing not found');
    if (row.ownerId !== u.id) throw Forbidden('Not your listing');
    const body = req.body as any;
    const updated = await prisma.listing.update({
      where: { id: row.id },
      data: {
        ...(body.title !== undefined ? { title: stripHtml(body.title) } : {}),
        ...(body.city !== undefined ? { city: body.city } : {}),
        ...(body.locality !== undefined ? { locality: body.locality } : {}),
        ...(body.rent !== undefined ? { rent: body.rent } : {}),
        ...(body.deposit !== undefined ? { deposit: body.deposit } : {}),
        ...(body.bills !== undefined ? { bills: body.bills } : {}),
        ...(body.description !== undefined ? { description: stripHtml(body.description) } : {}),
        ...(body.photos !== undefined ? { photos: body.photos } : {}),
        ...(body.amenities !== undefined ? { amenities: body.amenities } : {}),
        ...(body.availableFrom !== undefined ? { availableFrom: new Date(body.availableFrom) } : {}),
      },
    });
    res.json(updated);
  } catch (e) { next(e); }
}

export async function deleteListing(req: Request, res: Response, next: NextFunction) {
  try {
    const u = (req as any).user;
    const row = await prisma.listing.findUnique({ where: { id: req.params.id! } });
    if (!row) throw NotFound('Listing not found');
    if (row.ownerId !== u.id) throw Forbidden('Not your listing');
    await prisma.listing.delete({ where: { id: row.id } });
    res.status(204).send();
  } catch (e) { next(e); }
}
