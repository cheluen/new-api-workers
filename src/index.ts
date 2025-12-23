import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import type { CloudflareBindings } from './types';
import { errorHandler, requestId, timing } from './middleware';
import { userRoutes, tokenRoutes, channelRoutes, relayRoutes, miscRoutes, modelRoutes, vendorRoutes } from './routes';

// 使用 strict: false 让 Hono 自动处理尾部斜杠
const app = new Hono<{ Bindings: CloudflareBindings }>({ strict: false });
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

app.notFound((c) => {
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
