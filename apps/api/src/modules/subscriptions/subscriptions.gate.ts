// Wraps the Search module's response so nutriments are omitted entirely
// (not present-but-null) unless the demo user's subscription is active.
//
// This lives in the Subscriptions module, not Search, so the dependency
// points the way the plan describes: Subscriptions depends on Search's
// response shape (imports its types below), Search has zero awareness of
// Subscriptions. shared/app.ts mounts this middleware in front of
// searchRouter rather than search.service.ts importing anything from here.
import type { NextFunction, Request, Response } from 'express';
import type { SearchProduct, SearchResponseBody } from '../search/search.types';
import { isNutrimentsUnlocked } from './subscriptions.service';

function omitNutriments(product: SearchProduct): SearchProduct {
  const { nutriments: _nutriments, ...rest } = product;
  return rest;
}

// Pure and exported separately from the middleware below so it's directly
// unit-testable without spinning up a request.
export function applyNutrimentsGate(body: SearchResponseBody, unlocked: boolean): SearchResponseBody {
  if (unlocked || !Array.isArray(body.results)) {
    return body;
  }

  return {
    ...body,
    results: body.results.map(omitNutriments),
  };
}

function looksLikeSearchResponseBody(body: unknown): body is SearchResponseBody {
  return typeof body === 'object' && body !== null && Array.isArray((body as { results?: unknown }).results);
}

// Determines subscription status once per request, then patches res.json so
// whatever the Search route (mounted after this middleware) sends is gated
// on the way out - the route itself needs no changes and no knowledge that
// gating exists.
export async function gateSearchNutriments(_req: Request, res: Response, next: NextFunction): Promise<void> {
  const unlocked = await isNutrimentsUnlocked();
  const originalJson = res.json.bind(res);

  res.json = ((body: unknown) => {
    const gatedBody = looksLikeSearchResponseBody(body) ? applyNutrimentsGate(body, unlocked) : body;
    return originalJson(gatedBody);
  }) as Response['json'];

  next();
}
