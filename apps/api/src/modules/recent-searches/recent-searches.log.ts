// Middleware that logs a Search request as a recent search for the demo
// user - a pure side effect that never touches the outgoing response body
// (contrast with subscriptions.gate.ts, which rewrites it to strip
// nutriments).
//
// Architecture note: the plan's dependency direction is "Subscriptions
// depends on Search, not the other way around" / "Search itself has no
// gating logic of its own" - and the same reasoning is followed here even
// though this isn't gating. Rather than having search.route.ts import and
// call into this module directly, this follows subscriptions.gate.ts's
// established precedent: a middleware, owned by this module, that wraps
// res.json and is applied in shared/app.ts in front of searchRouter. That
// keeps Search itself unaware Recent Searches exists (same as it's unaware
// Subscriptions exists), and keeps the two "wrap the Search response for a
// side purpose" concerns symmetric - one middleware per concern, both
// mounted the same way - rather than one being a middleware and the other
// reaching directly into search.route.ts.
//
// Only a genuinely successful search gets logged: a 200 response whose body
// looks like a real Search response (has a `results` array - even an empty
// one, since a zero-result search is still a real search attempt worth
// remembering). A 400 (missing query, never reached Open Food Facts) or a
// 502/504 (upstream failure, rendered by shared/errorHandler.ts) never
// produces a body shaped like this, so both are excluded by the same check
// without needing to special-case them individually.
//
// The write is awaited before the response is actually sent (see below) -
// deliberately not truly fire-and-forget. apps/web's SearchExperience
// re-fetches GET /api/searches/recent immediately after a search completes,
// so if the record write and the search response raced each other, that
// refetch could occasionally land before the row was committed and
// silently miss the search the user just made. Waiting costs one extra
// local DB round-trip - negligible next to the OFF request Search itself
// just made - in exchange for the guarantee that once a client sees a
// successful search response, asking for recent searches immediately after
// is guaranteed to reflect it.
import type { NextFunction, Request, Response } from 'express';
import { recordSearch } from './recent-searches.service';

interface SearchLikeBody {
  query: string;
  results: unknown[];
}

function looksLikeSuccessfulSearchBody(body: unknown): body is SearchLikeBody {
  return (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as { query?: unknown }).query === 'string' &&
    Array.isArray((body as { results?: unknown }).results)
  );
}

export function logRecentSearch(_req: Request, res: Response, next: NextFunction): void {
  const originalJson = res.json.bind(res);

  res.json = ((body: unknown) => {
    if (res.statusCode === 200 && looksLikeSuccessfulSearchBody(body)) {
      // res.json() itself still returns synchronously (matching Express's
      // normal contract - nothing here awaits this call), but the actual
      // response send (originalJson) is deferred until the write settles.
      // A failure to record is caught and swallowed (logged server-side
      // only) via .finally, rather than surfaced - it must never turn an
      // otherwise-successful search into a failed response, and there's no
      // reasonable way for a client to react to "your search worked but we
      // failed to remember it" anyway.
      void recordSearch(body.query)
        .catch((err) => {
          console.error('Failed to record recent search:', err);
        })
        .finally(() => {
          originalJson(body);
        });
      return res;
    }
    return originalJson(body);
  }) as Response['json'];

  next();
}
