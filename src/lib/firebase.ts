import { initializeApp, cert, getApps, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { env } from '../config/env.js';

// why: Firebase Admin SDK only initializes when all three creds present.
// Keeps local dev (no Firebase creds) working via DEMO_MODE fallback.
let app: App | null = null;

export function getFirebaseAdmin(): App | null {
  if (app) return app;
  if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
    return null;
  }
  // why: dev watch mode can reload this module — reuse existing app if present.
  const existing = getApps();
  if (existing.length > 0) {
    app = existing[0] ?? null;
    return app;
  }
  app = initializeApp({
    credential: cert({
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      // why: Render stores newlines escaped. Unescape before passing to the SDK.
      privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
  });
  return app;
}

export function getFirebaseAuth(): Auth | null {
  const a = getFirebaseAdmin();
  return a ? getAuth(a) : null;
}

export function isFirebaseConfigured(): boolean {
  return Boolean(env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY);
}
