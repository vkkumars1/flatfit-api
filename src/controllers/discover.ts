import type { Request, Response, NextFunction } from 'express';
import { loadCandidatePool } from '../repositories/discover.js';
import { computeScore, hardFilterOk, reasons } from '../services/matching.js';
import { cache, cacheKey } from '../lib/cache.js';

export async function getDiscover(req: Request, res: Response, next: NextFunction) {
  try {
    const u = (req as any).user;
    const city = (req.query.city as string | undefined) ?? undefined;
    const cursor = req.query.cursor as string | undefined;
    const key = cacheKey('discover', u.id, city ?? '', cursor ?? '');

    let cached = cache.get<any[]>(key);
    if (!cached) {
      const { me, candidates } = await loadCandidatePool(u.id, city);
      if (!me) { res.json({ items: [], nextCursor: null }); return; }
      const items = candidates
        .filter((c) => c.profile && c.lifestyle)
        .map((c) => {
          if (!hardFilterOk({ city: me.profile!.city ?? "", budgetMin: me.profile!.budgetMin ?? 0, budgetMax: me.profile!.budgetMax ?? 999999 }, { city: c.profile!.city ?? "", budgetMin: c.profile!.budgetMin ?? 0, budgetMax: c.profile!.budgetMax ?? 999999 })) return null;
          const a = { ...me.lifestyle!, city: me.profile!.city, budgetMin: me.profile!.budgetMin, budgetMax: me.profile!.budgetMax };
          const b = { ...c.lifestyle!,  city: c.profile!.city,  budgetMin: c.profile!.budgetMin,  budgetMax: c.profile!.budgetMax };
          const { score, breakdown } = computeScore(a as any, b as any);
          const r = reasons(breakdown);
          const age = c.dob ? Math.floor((Date.now() - new Date(c.dob).getTime()) / (365.25 * 86400000)) : null;
          return {
            userId: c.id, name: c.name, age, city: c.profile!.city,
            photos: c.profile!.photos, score, topReasons: r.top,
            lifestyleChips: [
              { label: 'Cleanliness', same: a.cleanliness === b.cleanliness },
              { label: 'Smoking', same: a.smoking === b.smoking },
              { label: 'Diet', same: a.diet === b.diet },
            ],
            budgetMin: c.profile!.budgetMin, budgetMax: c.profile!.budgetMax,
          };
        })
        .filter(Boolean) as any[];
      items.sort((x, y) => (y.score - x.score) || x.userId.localeCompare(y.userId));
      cached = items;
      cache.set(key, items);
    }

    const pageSize = 20;
    const startIdx = cursor ? cached.findIndex((x) => x.userId === cursor) + 1 : 0;
    const page = cached.slice(startIdx, startIdx + pageSize);
    const nextCursor = startIdx + pageSize < cached.length ? page[page.length - 1]?.userId : null;
    res.json({ items: page, nextCursor });
  } catch (e) { next(e); }
}
