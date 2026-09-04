// GET /api/search?q=...&locale=...&page=...&pageSize=...
//
// Validates input and delegates to search.service. Errors thrown by the
// service (SearchUpstreamError, carrying a `.status`) are forwarded via
// `next` and rendered by the shared error handler in shared/errorHandler.ts
// - Express 5 forwards rejected promises from async handlers automatically,
// so no try/catch is needed here for that path.
import { Router, type Request, type Response } from 'express';
import { searchProducts } from './search.service';
import { SUPPORTED_LOCALES, type SupportedLocale } from './search.types';

export const searchRouter = Router();

const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 50;

function parsePositiveInt(value: unknown, fallback: number, max?: number): number {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return typeof max === 'number' ? Math.min(parsed, max) : parsed;
}

function resolveLocale(value: unknown): SupportedLocale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value)
    ? (value as SupportedLocale)
    : 'en';
}

searchRouter.get('/', async (req: Request, res: Response) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

  if (!q) {
    res.status(400).json({ error: { message: 'Query parameter "q" is required.' } });
    return;
  }

  const locale = resolveLocale(req.query.locale);
  const page = parsePositiveInt(req.query.page, 1);
  const pageSize = parsePositiveInt(req.query.pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

  const result = await searchProducts({ query: q, locale, page, pageSize });

  res.json({
    query: q,
    locale,
    page: result.page,
    pageSize: result.pageSize,
    totalCount: result.totalCount,
    totalPages: result.totalPages,
    results: result.results,
  });
});
