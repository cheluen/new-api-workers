# New API Workers

LLM API Gateway on Cloudflare Workers with D1 Database.

## Features

- **Pure D1 Database**: No KV storage needed, all data stored in SQLite-based D1
- **JWT Authentication**: Stateless auth for user sessions
- **Cache API**: Free caching using Cloudflare Cache API
- **SSE Streaming**: Full support for streaming responses via relay proxy
- **Multi-Channel Support**: OpenAI, Azure, Anthropic, Google and custom providers
- **Token Management**: API key generation with quota and model restrictions
- **Usage Logging**: Track all API requests and token consumption

## Architecture

```
┌─────────────┐     ┌───────────────────┐     ┌─────────────────┐
│   Client    │────▶│  Workers Gateway  │────▶│  Render Relay   │
│             │◀────│  (D1 + Cache API) │◀────│  (Docker/Node)  │
└─────────────┘     └───────────────────┘     └─────────────────┘
                              │                        │
                              │                        ▼
                              │               ┌─────────────────┐
                              │               │  Upstream LLM   │
                              ▼               │  (OpenAI, etc)  │
                    ┌───────────────────┐     └─────────────────┘
                    │   Cloudflare D1   │
                    │    (SQLite DB)    │
                    └───────────────────┘
```

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Create D1 Database

```bash
npx wrangler d1 create new-api-db
```

Update `wrangler.toml` with the returned database ID.

### 3. Configure Secrets

```bash
# Copy example config
cp .dev.vars.example .dev.vars

# Edit with your values
vim .dev.vars
```

Set production secrets:
```bash
npx wrangler secret put JWT_SECRET
npx wrangler secret put RELAY_PROXY_URL
npx wrangler secret put RELAY_PROXY_KEY
```

### 4. Run Migrations

```bash
# Local development
npm run db:migrate:local
npm run db:seed:local

# Production
npm run db:migrate:remote
```

### 5. Development

```bash
npm run dev
```

### 6. Deploy

```bash
npm run deploy
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

## Usage Examples

### Register and Login

```bash
# Register
curl -X POST http://localhost:8787/api/user/register \
  -H "Content-Type: application/json" \
  -d '{"username": "test", "password": "test123"}'

# Login
curl -X POST http://localhost:8787/api/user/login \
  -H "Content-Type: application/json" \
  -d '{"username": "test", "password": "test123"}'
```

### Create API Token

```bash
# Use JWT token from login
curl -X POST http://localhost:8787/api/token \
  -H "Authorization: Bearer <jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "My API Key"}'
```

### Chat Completion

```bash
# Use API key from token creation
curl -X POST http://localhost:8787/v1/chat/completions \
  -H "Authorization: Bearer sk-xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### Streaming

```bash
curl -X POST http://localhost:8787/v1/chat/completions \
  -H "Authorization: Bearer sk-xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Tell me a story"}],
    "stream": true
  }'
```

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

## Default Admin

- Username: `admin`
- Password: `123456`

**Change this password immediately in production!**

## License

MIT
