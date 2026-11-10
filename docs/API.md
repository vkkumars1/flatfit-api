# FlatFit API

Live docs: visit `/docs` on the running server (Swagger UI). Machine-readable spec at `docs/openapi.yaml`.

## Base URL

- Local: `http://localhost:4000`
- Prod: set to your Render URL (e.g. `https://flatfit-api.onrender.com`)

## Auth

OTP-based. Flow:

1. `POST /auth/send-otp { phone }` → `{ ok, resendInSeconds }`. In `DEMO_MODE=true` and `phone === DEMO_PHONE`, OTP is `DEMO_OTP` (default `123456`).
2. `POST /auth/verify-otp { phone, otp }` → `{ accessToken, user, isNewUser }` and sets an httpOnly refresh cookie on `/auth`.
3. Send `Authorization: Bearer <accessToken>` on every protected request.
4. When access token expires (15m) → `POST /auth/refresh` (cookie-based) → `{ accessToken, user }`. Refresh token is rotated; reuse triggers family revoke.
5. `POST /auth/logout` → clears cookie, revokes family. `204`.

## Error shape

```json
{ "error": { "code": "BAD_REQUEST", "message": "...", "details": { } } }
```

HTTP codes: `400 BAD_REQUEST`, `401 UNAUTHORIZED`, `403 FORBIDDEN`, `404 NOT_FOUND`, `409 CONFLICT`, `429 TOO_MANY`, `500 SERVER_ERROR`.

`429` always includes `Retry-After` seconds.

## Pagination

All list endpoints return `{ items, nextCursor }`. `cursor` is opaque; default page size `20`, max `50`.

## Endpoints at a glance

| Method | Path | Auth |
|---|---|---|
| GET | `/health` | public |
| POST | `/auth/send-otp` | public |
| POST | `/auth/verify-otp` | public |
| POST | `/auth/refresh` | cookie |
| POST | `/auth/logout` | bearer |
| GET | `/me` | bearer |
| PUT | `/me/profile` | bearer |
| PUT | `/me/lifestyle` | bearer |
| PUT | `/me/deal-breakers` | bearer |
| POST | `/me/photos/upload-url` | bearer |
| GET | `/discover?cursor=&city=&min=&max=` | bearer |
| POST | `/swipes` | bearer |
| GET | `/matches?cursor=` | bearer |
| GET | `/matches/:id/compatibility` | bearer |
| GET | `/matches/:id/messages?cursor=` | bearer |
| POST | `/matches/:id/messages` | bearer |
| GET | `/matches/:id/agreement` | bearer |
| POST | `/matches/:id/agreement` | bearer |
| PUT | `/agreements/:id/accept` | bearer |
| GET | `/listings?city=&min=&max=&verified=&cursor=` | public |
| GET | `/listings/:id` | public |
| POST | `/listings` | bearer |
| PUT | `/listings/:id` | owner |
| DELETE | `/listings/:id` | owner |
| POST | `/reports` | bearer |
| GET | `/blocks` | bearer |
| POST | `/blocks` | bearer |
| DELETE | `/blocks/:userId` | bearer |
| POST | `/verify/selfie` | bearer |
| POST | `/payments/order` | bearer |
| POST | `/payments/webhook` | signature |
| POST | `/payments/mock-confirm` | bearer + DEMO_MODE |
| GET | `/admin/verifications?cursor=` | admin |
| PUT | `/admin/verifications/:id` | admin |

## Rate limits

- `send-otp`: 3 / 10 min per phone+IP.
- `verify-otp`: 10 / 10 min per IP.
- `messages`: 30 / min per user.
- Global: 100 / min per IP.

## Socket.io

Connect to the same origin; pass access token in the handshake:

```ts
io(SOCKET_URL, { auth: { token: accessToken } })
```

Rooms: each user joins `user:<id>` automatically after handshake.

- Client → Server: `typing { matchId }`, `read { matchId }`.
- Server → Client: `message`, `typing`, `read`, `match`.

Every event re-checks match membership; blocks are filtered.

## Listing shape (frontend contract)

```ts
{
  id, title, city, locality, rent, deposit,
  bills, description, photos:[{id,url}],
  amenities:string[], availableFrom, verified
}
```

Exact street address is never returned.
