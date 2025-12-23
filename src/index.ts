import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import type { CloudflareBindings } from './types';
import { errorHandler, requestId, timing } from './middleware';
import { userRoutes, tokenRoutes, channelRoutes, relayRoutes, miscRoutes, modelRoutes, vendorRoutes } from './routes';

// Extended bindings type with ASSETS
interface ExtendedBindings extends CloudflareBindings {
  ASSETS?: {
    fetch: (request: Request) => Promise<Response>;
  };
}

// 使用 strict: false 让 Hono 自动处理尾部斜杠
const app = new Hono<{ Bindings: ExtendedBindings }>({ strict: false });
app.use('*', errorHandler());
app.use('*', requestId());
app.use('*', timing());
app.use('*', secureHeaders());
app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'New-Api-User', 'Cache-Control', 'Pragma', 'Accept', 'Accept-Language'],
    exposeHeaders: ['X-Request-Id', 'X-Response-Time'],
    maxAge: 86400,
  })
);

app.get('/', (c) => {
  return c.json({
    name: 'New API',
    version: '1.0.0',
    description: 'LLM API Gateway on Cloudflare Workers',
    endpoints: {
      health: 'GET /health',
      user: '/api/user/*',
      token: '/api/token/*',
      channel: '/api/channel/*',
      relay: '/v1/*',
    },
  });
});

app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

app.route('/api/user', userRoutes);
app.route('/api/token', tokenRoutes);
app.route('/api/channel', channelRoutes);
app.route('/api/models', modelRoutes);
app.route('/api/vendors', vendorRoutes);
app.route('/api', miscRoutes);
app.route('/', relayRoutes);

// Handle 404 - For SPA, serve index.html for non-API routes
app.notFound(async (c) => {
  const url = new URL(c.req.url);
  const path = url.pathname;

  // If it's an API route, return JSON error
  if (path.startsWith('/api/') || path.startsWith('/v1/')) {
    return c.json(
      {
        error: {
          message: 'Not Found',
          type: 'invalid_request_error',
          code: 'not_found',
        },
      },
      404
    );
  }

  // For SPA routes, try to serve through ASSETS binding
  // The static assets are automatically served by Cloudflare Workers
  // For routes like /console, /login, etc., the ASSETS should serve index.html
  if (c.env.ASSETS) {
    // Try to serve the exact file first
    const assetResponse = await c.env.ASSETS.fetch(c.req.raw);
    if (assetResponse.status !== 404) {
      return assetResponse;
    }

    // For SPA fallback, serve index.html
    const indexUrl = new URL('/index.html', c.req.url);
    const indexRequest = new Request(indexUrl.toString(), c.req.raw);
    return c.env.ASSETS.fetch(indexRequest);
  }

  // Fallback if no ASSETS binding
  return c.json(
    {
      error: {
        message: 'Not Found',
        type: 'invalid_request_error',
        code: 'not_found',
      },
    },
    404
  );
});

app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json(
    {
      error: {
        message: 'Internal Server Error',
        type: 'server_error',
        code: 'internal_error',
      },
    },
    500
  );
});

export default app;
