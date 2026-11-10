import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { validate } from '../middleware/validate.js';
import { listingCreateSchema, listingUpdateSchema } from '../validators/listings.js';
import { listListings, getListing, createListing, updateListing, deleteListing } from '../controllers/listings.js';

export const listingsRouter = Router();
listingsRouter.get('/', listListings);                // why: listings browsing is public for discovery.
listingsRouter.get('/:id', getListing);
listingsRouter.post('/', requireAuth, validate(listingCreateSchema), createListing);
listingsRouter.put('/:id', requireAuth, validate(listingUpdateSchema), updateListing);
listingsRouter.delete('/:id', requireAuth, deleteListing);
