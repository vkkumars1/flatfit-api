# Decisions

- Node 22 LTS (works for Node 20 spec target; `engines.node` is set to `>=20`).
- ESM output (`"type": "module"` + NodeNext).
- Listing model extends BACKEND_SPEC with `bills:number` and `description:string` because the frontend requires them.
- `mode` accepts both `HAS_FLAT|NEEDS_FLAT` and `have-flat|need-flat`; canonical form is `HAS_FLAT|NEEDS_FLAT`.
- Agreement `rules` stored as structured JSON per spec; the frontend's string[] view is a separate projection.
- Payments mode auto-switches to `mock` when Razorpay keys are missing; `/payments/mock-confirm` only works when `DEMO_MODE=true`.
- Redis replaced by `node-cache` with 60s TTL per spec's "no Redis" rule.
- OTP provider pattern: `ConsoleProvider` logs code in dev; `MSG91Provider` is left as a TODO stub for when real SMS is wired.
- Discover cache key is `discover:<userId>:<city>:<cursor>` and is invalidated on every swipe or profile update.
