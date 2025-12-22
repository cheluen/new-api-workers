# New API Workers

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cheluen/new-api-workers)

LLM API Gateway on Cloudflare Workers with D1 Database. A serverless implementation of [new-api](https://github.com/Calcium-Ion/new-api) for Cloudflare's edge network.

## Features

- **Pure D1 Database**: All data stored in SQLite-based D1, no KV storage needed
- **JWT Authentication**: Stateless auth for user sessions
- **Cache API**: Free caching using Cloudflare Cache API
- **SSE Streaming**: Full support for streaming responses via relay proxy
- **Multi-Channel Support**: OpenAI, Azure, Anthropic, Google and custom providers
- **Token Management**: API key generation with quota and model restrictions
- **Usage Logging**: Track all API requests and token consumption
- **One-Click Deploy**: Deploy to Cloudflare with a single click

## Architecture

```
┌─────────────┐     ┌───────────────────┐     ┌─────────────────┐
│   Client    │────▶│  Workers Gateway  │────▶│  Render Relay   │
│             │◀────│  (D1 + Cache API) │◀────│  (Docker/Node)  │
└─────────────┘     └───────────────────┘     └─────────────────┘
                              │                        │
                              │                        ▼
                              │               ┌─────────────────┐
                              ▼               │  Upstream LLM   │
                    ┌───────────────────┐     │  (OpenAI, etc)  │
                    │   Cloudflare D1   │     └─────────────────┘
                    │    (SQLite DB)    │
                    └───────────────────┘
```

## One-Click Deployment

### Option 1: Deploy Button (Recommended)

Click the button above to deploy directly to Cloudflare Workers.

During deployment, you'll be prompted to configure:
- **JWT_SECRET**: JWT signing secret (generate with `openssl rand -hex 32`)
- **RELAY_PROXY_URL** (optional): Render relay proxy URL for SSE streaming
- **RELAY_PROXY_KEY** (optional): Relay proxy authentication key

### Option 2: Manual Deployment

```bash
# Clone repository
git clone https://github.com/cheluen/new-api-workers.git
cd new-api-workers

# Install dependencies
npm install

# Create D1 database
npx wrangler d1 create new-api-db
# Update wrangler.toml with the returned database_id

# Set secrets
npx wrangler secret put JWT_SECRET
npx wrangler secret put RELAY_PROXY_URL  # optional
npx wrangler secret put RELAY_PROXY_KEY  # optional

# Deploy (runs migrations automatically)
npm run deploy
```

## Frontend Deployment

The frontend is located in the `web/` directory and can be deployed to Cloudflare Pages:

```bash
cd web
npm install
npm run build

# Deploy to Cloudflare Pages
npx wrangler pages deploy dist --project-name=new-api-web
```

Set the environment variable `VITE_REACT_APP_SERVER_URL` to your Workers API URL before building.

## Local Development

```bash
# Copy environment variables
cp .dev.vars.example .dev.vars
# Edit .dev.vars with your values

# Run database migrations locally
npm run db:migrate:local
npm run db:seed:local

# Start development server (Workers)
npm run dev

# In another terminal, start frontend
cd web
npm install
npm run dev
```

## API Endpoints

### Public Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /` | Service info |
| `GET /health` | Health check |
| `POST /api/user/register` | User registration |
| `POST /api/user/login` | User login |

### Authenticated Endpoints (JWT Token)

| Endpoint | Description |
|----------|-------------|
| `GET /api/user/self` | Get current user |
| `PUT /api/user/self` | Update profile |
| `GET /api/token` | List API tokens |
| `POST /api/token` | Create API token |
| `GET /api/token/:id` | Get token details |
| `PUT /api/token/:id` | Update token |
| `DELETE /api/token/:id` | Delete token |

### Admin Endpoints (Admin JWT)

| Endpoint | Description |
|----------|-------------|
| `GET /api/channel` | List channels |
| `POST /api/channel` | Create channel |
| `GET /api/channel/:id` | Get channel |
| `PUT /api/channel/:id` | Update channel |
| `DELETE /api/channel/:id` | Delete channel |

### Relay Endpoints (API Key)

| Endpoint | Description |
|----------|-------------|
| `GET /v1/models` | List available models |
| `POST /v1/chat/completions` | Chat completions (streaming supported) |
| `POST /v1/embeddings` | Text embeddings |

## Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `JWT_SECRET` | JWT signing secret | Yes |
| `RELAY_PROXY_URL` | Render relay proxy URL | No |
| `RELAY_PROXY_KEY` | Relay proxy auth key | No |
| `ALLOWED_ORIGINS` | CORS origins (default: *) | No |
| `TOKEN_EXPIRY_HOURS` | JWT expiry (default: 24) | No |

### Channel Types

| Type ID | Provider |
|---------|----------|
| 1 | OpenAI |
| 3 | Azure OpenAI |
| 14 | Anthropic Claude |
| 24 | Google Gemini |
| 99 | Custom |

## Relay Proxy Setup (Optional)

For SSE streaming support, deploy the relay proxy to Render:

1. Fork [llm-proxy-relay](https://github.com/cheluen/llm-proxy-relay)
2. Create a new Web Service on Render
3. Connect to your forked repository
4. Set environment variables:
   - `PROXY_SECRET_KEY`: Same as your `RELAY_PROXY_KEY`
   - `PORT`: 3000
5. Deploy

## Default Admin

After first deployment:
- Username: `admin`
- Password: `123456`

**Change this password immediately in production!**

## Usage Examples

### Register and Login

```bash
# Register
curl -X POST https://your-worker.workers.dev/api/user/register \
  -H "Content-Type: application/json" \
  -d '{"username": "test", "password": "test123456"}'

# Login
curl -X POST https://your-worker.workers.dev/api/user/login \
  -H "Content-Type: application/json" \
  -d '{"username": "test", "password": "test123456"}'
```

### Create API Token

```bash
curl -X POST https://your-worker.workers.dev/api/token \
  -H "Authorization: Bearer <jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "My API Key"}'
```

### Chat Completion

```bash
curl -X POST https://your-worker.workers.dev/v1/chat/completions \
  -H "Authorization: Bearer sk-xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### Streaming

```bash
curl -X POST https://your-worker.workers.dev/v1/chat/completions \
  -H "Authorization: Bearer sk-xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Tell me a story"}],
    "stream": true
  }'
```

## License

MIT
