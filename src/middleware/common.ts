import { Context, Next } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { CloudflareBindings } from '../types';

export const errorHandler = () => {
  return async (c: Context<{ Bindings: CloudflareBindings }>, next: Next) => {
    try {
      await next();
    } catch (err) {
      console.error('Unhandled error:', err);

      const statusNum =
        err instanceof Error && 'status' in err ? (err as { status: number }).status : 500;
      const status = (
        statusNum >= 200 && statusNum < 600 ? statusNum : 500
      ) as ContentfulStatusCode;
      const message = err instanceof Error ? err.message : 'Internal server error';

      return c.json({ success: false, message }, status);
    }
  };
};

export const requestId = () => {
  return async (c: Context<{ Bindings: CloudflareBindings }>, next: Next) => {
    const id = c.req.header('X-Request-Id') || crypto.randomUUID();
    c.header('X-Request-Id', id);
    await next();
  };
};

export const timing = () => {
  return async (c: Context<{ Bindings: CloudflareBindings }>, next: Next) => {
    const start = Date.now();
    await next();
    const duration = Date.now() - start;
    c.header('X-Response-Time', `${duration}ms`);
  };
};
