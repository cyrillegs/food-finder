// Wraps the Search module's response so nutriments are omitted entirely
// (not present-but-null) unless the requesting user is logged in AND their
// subscription is active.
//
// This lives in the Subscriptions module, not Search, so the dependency
// points the way the plan describes: Subscriptions depends on Search's
// response shape (imports its types below), Search has zero awareness of
// Subscriptions. shared/app.ts mounts this middleware in front of
// searchRouter rather than search.service.ts importing anything from here.
//
// Search itself stays open/anonymous (per the assignment brief - "everyone
// can view basic information"), so this middleware runs on every search
// request, logged in or not. getCurrentUser resolves to null for an
// anonymous request (no session cookie) without throwing or requiring
// auth - an anonymous searcher simply sees locked nutriments, same as
// before, just via "no session" rather than "not subscribed" against a
// hardcoded row that no longer exists.
import type { NextFunction, Request, Response } from 'express';
import type { SearchProduct, SearchResponseBody } from '../search/search.types';
import { getCurrentUser } from '../auth/auth.middleware';

function omitNutriments(product: SearchProduct): SearchProduct {
  const { nutriments: _nutriments, ...rest } = product;
  return rest;
}

// Search's own response shape carries no notion of subscriptions - this is
// the superset the gate actually sends. The frontend needs `subscriptionActive`
// as an explicit flag, not just inferred from whether any given product
// happens to have `nutriments`: plenty of real Open Food Facts products have
// no nutrition data submitted at all regardless of subscription state (the
// same reason some have no image), and conflating "you're not subscribed"
// with "this product has no data" produced a real bug - a subscribed user
// still saw a "Subscribe to unlock" button on those products, which does
// nothing useful since there's nothing to unlock.
export interface GatedSearchResponseBody extends SearchResponseBody {
  subscriptionActive: boolean;
}

// Pure and exported separately from the middleware below so it's directly
// unit-testable without spinning up a request.
export function applyNutrimentsGate(body: SearchResponseBody, unlocked: boolean): GatedSearchResponseBody {
  if (!Array.isArray(body.results)) {
    return { ...body, subscriptionActive: unlocked };
  }

  return {
    ...body,
    subscriptionActive: unlocked,
    results: unlocked ? body.results : body.results.map(omitNutriments),
  };
}

function looksLikeSearchResponseBody(body: unknown): body is SearchResponseBody {
  return typeof body === 'object' && body !== null && Array.isArray((body as { results?: unknown }).results);
}

// Determines subscription status once per request, then patches res.json so
// whatever the Search route (mounted after this middleware) sends is gated
// on the way out - the route itself needs no changes and no knowledge that
// gating exists.
export async function gateSearchNutriments(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = await getCurrentUser(req);
  const unlocked = user?.subscriptionStatus === 'active';
  const originalJson = res.json.bind(res);

  res.json = ((body: unknown) => {
    const gatedBody = looksLikeSearchResponseBody(body) ? applyNutrimentsGate(body, unlocked) : body;
    return originalJson(gatedBody);
  }) as Response['json'];

  next();
}
