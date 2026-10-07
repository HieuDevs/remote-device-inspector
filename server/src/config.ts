import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEVICE_PORT = Number(process.env.DEVICE_PORT || 7000);
export const HTTP_PORT = Number(process.env.HTTP_PORT || 8080);

/** Built dashboard (web/dist). Same relative path from src/ (tsx) and dist/ (node). */
export const WEB_DIST = path.resolve(process.env.WEB_DIST || fileURLToPath(new URL('../../web/dist', import.meta.url)));

/** Largest JSON body accepted by /ingest and /exec — a guard, bodies are never cut. */
export const MAX_JSON_BODY = 256 * 1024 * 1024;
export const EXEC_TIMEOUT_MS = 25_000;
/** Debug flows replayed to a viewer that (re)connects. */
export const MAX_DEBUG_HISTORY = 100;
