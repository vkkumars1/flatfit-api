import 'dotenv/config';

const BASE = process.env.BASE_URL ?? 'http://localhost:4000';
type Row = { name: string; ok: boolean; detail?: string };
const rows: Row[] = [];

async function j(path: string, init?: RequestInit) {
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await r.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch {}
  return { status: r.status, body, headers: r.headers };
}

function record(name: string, ok: boolean, detail?: string) { rows.push({ name, ok, detail }); }

async function main() {
  const phone = process.env.DEMO_PHONE ?? '+919999999999';
  const otp = process.env.DEMO_OTP ?? '123456';

  const health = await j('/health');
  record('GET /health', health.status === 200 && health.body?.status === 'ok');

  await j('/auth/send-otp', { method: 'POST', body: JSON.stringify({ phone }) });
  record('POST /auth/send-otp', true);

  const v = await j('/auth/verify-otp', { method: 'POST', body: JSON.stringify({ phone, otp }) });
  const token = v.body?.accessToken as string | undefined;
  record('POST /auth/verify-otp', v.status === 200 && !!token);

  const auth = { authorization: `Bearer ${token ?? ''}` };
  const me = await j('/me', { headers: auth });
  record('GET /me', me.status === 200);

  const disc = await j('/discover', { headers: auth });
  record('GET /discover', disc.status === 200);

  const mt = await j('/matches', { headers: auth });
  record('GET /matches', mt.status === 200);

  const list = await j('/listings');
  record('GET /listings', list.status === 200);

  const blocks = await j('/blocks', { headers: auth });
  record('GET /blocks', blocks.status === 200);

  const order = await j('/payments/order', { method: 'POST', headers: auth, body: JSON.stringify({ plan: 'VERIFIED' }) });
  record('POST /payments/order', order.status === 200);

  console.log('\nFlatFit smoke report');
  console.log('-----------------------------------');
  for (const r of rows) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  ' + r.detail : ''}`);
  const bad = rows.filter((r) => !r.ok).length;
  console.log(`-----------------------------------\n${rows.length - bad}/${rows.length} passed`);
  process.exit(bad === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
