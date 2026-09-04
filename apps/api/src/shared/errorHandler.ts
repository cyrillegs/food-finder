// Generic Express error-handling middleware. Feature modules can throw or
// call next(err) and let this catch it - no per-route try/catch boilerplate.
import type { NextFunction, Request, Response } from 'express';

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  // Log server-side with full detail; the client only ever sees a generic message.
  console.error('Unhandled error:', err);

  if (res.headersSent) {
    return;
  }

  const status =
    typeof err === 'object' && err !== null && 'status' in err && typeof (err as { status: unknown }).status === 'number'
      ? (err as { status: number }).status
      : 500;

  res.status(status).json({
    error: {
      message: status === 500 ? 'Internal server error' : (err as Error)?.message ?? 'Request failed',
    },
  });
}
