import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import type { CloudflareBindings, Channel } from '../types';
import { ChannelService, TokenService, UserService, LogService } from '../db';
import { apiKeyAuth } from '../middleware';
import { isModelAllowed, cacheGetOrSet } from '../utils';
import { ChannelType } from '../types';

type Variables = {
  tokenId: number;
  userId: number;
  tokenModels: string;
};

const relay = new Hono<{ Bindings: CloudflareBindings; Variables: Variables }>();

function getTargetUrl(channel: Channel, path: string): string {
  let baseUrl = channel.base_url;
  if (baseUrl.endsWith('/')) {
    baseUrl = baseUrl.slice(0, -1);
  }

  switch (channel.type) {
    case ChannelType.OPENAI:
      return `${baseUrl}${path}`;
    case ChannelType.AZURE:
      return `${baseUrl}${path}?api-version=2024-02-01`;
    case ChannelType.ANTHROPIC:
      if (path.includes('/chat/completions')) {
        return `${baseUrl}/v1/messages`;
      }
      return `${baseUrl}${path}`;
    case ChannelType.GOOGLE:
      return `${baseUrl}${path}`;
    default:
      return `${baseUrl}${path}`;
  }
}

function buildUpstreamHeaders(channel: Channel, originalHeaders: Headers): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  switch (channel.type) {
    case ChannelType.OPENAI:
    case ChannelType.CUSTOM:
      headers['Authorization'] = `Bearer ${channel.key}`;
      break;
    case ChannelType.AZURE:
      headers['api-key'] = channel.key;
      break;
    case ChannelType.ANTHROPIC:
      headers['x-api-key'] = channel.key;
      headers['anthropic-version'] = '2023-06-01';
      break;
    case ChannelType.GOOGLE:
      headers['Authorization'] = `Bearer ${channel.key}`;
      break;
  }

  const acceptEncoding = originalHeaders.get('Accept-Encoding');
  if (acceptEncoding) {
    headers['Accept-Encoding'] = acceptEncoding;
  }

  return headers;
}

function applyModelMapping(model: string, mappingJson: string): string {
  if (!mappingJson || mappingJson === '{}') {
    return model;
  }

  try {
    const mapping = JSON.parse(mappingJson) as Record<string, string>;
    return mapping[model] || model;
  } catch {
    return model;
  }
}

interface ChatCompletionRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
}

function transformRequestBody(
  channel: Channel,
  body: ChatCompletionRequest
): ChatCompletionRequest {
  const mappedModel = applyModelMapping(body.model, channel.model_mapping);
  return { ...body, model: mappedModel };
}

async function proxyViaRelay(
  c: { env: CloudflareBindings },
  method: string,
  targetUrl: string,
  headers: Record<string, string>,
  body: string | null,
  requestId: string
): Promise<Response> {
  const relayUrl = c.env.RELAY_PROXY_URL;
  const relayKey = c.env.RELAY_PROXY_KEY;

  if (!relayUrl) {
    return fetch(targetUrl, {
      method,
      headers,
      body,
    });
  }

  const relayHeaders: Record<string, string> = {
    ...headers,
    'X-Proxy-Key': relayKey,
    'X-Target-URL': targetUrl,
    'X-Request-Id': requestId,
  };

  return fetch(`${relayUrl}/proxy`, {
    method,
    headers: relayHeaders,
    body,
  });
}

relay.use('/v1/*', apiKeyAuth());

relay.post('/v1/chat/completions', async (c) => {
  const requestId = crypto.randomUUID();
  const startTime = Date.now();

  c.header('X-Request-Id', requestId);

  const tokenId = c.get('tokenId');
  const userId = c.get('userId');
  const tokenModels = c.get('tokenModels');

  let body: ChatCompletionRequest;
  try {
    body = await c.req.json<ChatCompletionRequest>();
  } catch {
    return c.json(
      {
        error: {
          message: 'Invalid JSON body',
          type: 'invalid_request_error',
          code: 'invalid_json',
        },
      },
      400
    );
  }

  if (!body.model) {
    return c.json(
      {
        error: {
          message: 'model is required',
          type: 'invalid_request_error',
          code: 'missing_model',
        },
      },
      400
    );
  }

  if (!isModelAllowed(body.model, tokenModels)) {
    return c.json(
      {
        error: {
          message: `Model ${body.model} is not allowed for this token`,
          type: 'invalid_request_error',
          code: 'model_not_allowed',
        },
      },
      403
    );
  }

  const channelService = new ChannelService(c.env.DB);

  const channels = await cacheGetOrSet(
    `channels:model:${body.model}`,
    async () => channelService.findEnabledForModel(body.model),
    60
  );

  if (channels.length === 0) {
    return c.json(
      {
        error: {
          message: `No available channel for model ${body.model}`,
          type: 'server_error',
          code: 'no_channel_available',
        },
      },
      503
    );
  }

  const channel = channelService.selectChannel(channels);
  if (!channel) {
    return c.json(
      {
        error: {
          message: 'Failed to select channel',
          type: 'server_error',
          code: 'channel_selection_failed',
        },
      },
      503
    );
  }

  const targetUrl = getTargetUrl(channel, '/v1/chat/completions');
  const upstreamHeaders = buildUpstreamHeaders(channel, c.req.raw.headers);
  const transformedBody = transformRequestBody(channel, body);

  console.log(`[${requestId}] Proxying to channel ${channel.id} (${channel.name})`);

  try {
    const response = await proxyViaRelay(
      c,
      'POST',
      targetUrl,
      upstreamHeaders,
      JSON.stringify(transformedBody),
      requestId
    );

    const contentType = response.headers.get('content-type') || '';
    const isStreaming = contentType.includes('text/event-stream');

    const logService = new LogService(c.env.DB);
    const tokenService = new TokenService(c.env.DB);
    const userService = new UserService(c.env.DB);

    if (isStreaming && response.body) {
      return stream(c, async (streamWriter) => {
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let fullResponse = '';
        let promptTokens = 0;
        let completionTokens = 0;

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            await streamWriter.write(value);

            const chunk = decoder.decode(value, { stream: true });
            fullResponse += chunk;

            const usageMatch = chunk.match(/"usage":\s*\{[^}]+\}/);
            if (usageMatch) {
              try {
                const usage = JSON.parse(`{${usageMatch[0]}}`).usage;
                promptTokens = usage.prompt_tokens || 0;
                completionTokens = usage.completion_tokens || 0;
              } catch {
                // Ignore parse errors
              }
            }
          }
        } finally {
          reader.releaseLock();

          const quota = promptTokens + completionTokens * 3;

          await Promise.all([
            logService.create({
              userId,
              tokenId,
              channelId: channel.id,
              model: body.model,
              promptTokens,
              completionTokens,
              quota,
              requestId,
              statusCode: response.status,
            }),
            tokenService.updateUsage(tokenId, quota),
            userService.updateQuota(userId, quota),
          ]);

          console.log(
            `[${requestId}] Stream completed in ${Date.now() - startTime}ms, tokens: ${promptTokens}+${completionTokens}`
          );
        }
      });
    }

    const responseBody = await response.text();

    let promptTokens = 0;
    let completionTokens = 0;

    try {
      const parsed = JSON.parse(responseBody);
      if (parsed.usage) {
        promptTokens = parsed.usage.prompt_tokens || 0;
        completionTokens = parsed.usage.completion_tokens || 0;
      }
    } catch {
      // Ignore parse errors
    }

    const quota = promptTokens + completionTokens * 3;

    await Promise.all([
      logService.create({
        userId,
        tokenId,
        channelId: channel.id,
        model: body.model,
        promptTokens,
        completionTokens,
        quota,
        requestId,
        statusCode: response.status,
      }),
      tokenService.updateUsage(tokenId, quota),
      userService.updateQuota(userId, quota),
    ]);

    console.log(
      `[${requestId}] Completed in ${Date.now() - startTime}ms, tokens: ${promptTokens}+${completionTokens}`
    );

    return new Response(responseBody, {
      status: response.status,
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Id': requestId,
      },
    });
  } catch (err) {
    console.error(`[${requestId}] Proxy error:`, err);
    return c.json(
      {
        error: {
          message: 'Failed to connect to upstream',
          type: 'server_error',
          code: 'upstream_error',
        },
      },
      502
    );
  }
});

relay.get('/v1/models', async (c) => {
  const channelService = new ChannelService(c.env.DB);
  const channels = await channelService.findEnabled();

  const modelsSet = new Set<string>();
  for (const ch of channels) {
    if (ch.models) {
      const models = ch.models.split(',').map((m) => m.trim());
      for (const model of models) {
        if (model && model !== '*') {
          modelsSet.add(model);
        }
      }
    }
  }

  const models = Array.from(modelsSet).map((id) => ({
    id,
    object: 'model',
    created: Math.floor(Date.now() / 1000),
    owned_by: 'new-api',
  }));

  return c.json({
    object: 'list',
    data: models,
  });
});

relay.post('/v1/embeddings', async (c) => {
  const requestId = crypto.randomUUID();
  c.header('X-Request-Id', requestId);

  const tokenId = c.get('tokenId');
  const userId = c.get('userId');
  const tokenModels = c.get('tokenModels');

  const body = await c.req.json<{ model: string; input: string | string[] }>();

  if (!body.model) {
    return c.json(
      {
        error: {
          message: 'model is required',
          type: 'invalid_request_error',
          code: 'missing_model',
        },
      },
      400
    );
  }

  if (!isModelAllowed(body.model, tokenModels)) {
    return c.json(
      {
        error: {
          message: `Model ${body.model} is not allowed for this token`,
          type: 'invalid_request_error',
          code: 'model_not_allowed',
        },
      },
      403
    );
  }

  const channelService = new ChannelService(c.env.DB);
  const channels = await channelService.findEnabledForModel(body.model);

  if (channels.length === 0) {
    return c.json(
      {
        error: {
          message: `No available channel for model ${body.model}`,
          type: 'server_error',
          code: 'no_channel_available',
        },
      },
      503
    );
  }

  const channel = channelService.selectChannel(channels);
  if (!channel) {
    return c.json(
      {
        error: {
          message: 'Failed to select channel',
          type: 'server_error',
          code: 'channel_selection_failed',
        },
      },
      503
    );
  }

  const targetUrl = getTargetUrl(channel, '/v1/embeddings');
  const upstreamHeaders = buildUpstreamHeaders(channel, c.req.raw.headers);

  try {
    const response = await proxyViaRelay(
      c,
      'POST',
      targetUrl,
      upstreamHeaders,
      JSON.stringify(body),
      requestId
    );

    const responseBody = await response.text();

    let promptTokens = 0;
    try {
      const parsed = JSON.parse(responseBody);
      if (parsed.usage) {
        promptTokens = parsed.usage.prompt_tokens || 0;
      }
    } catch {
      // Ignore
    }

    const logService = new LogService(c.env.DB);
    const tokenService = new TokenService(c.env.DB);
    const userService = new UserService(c.env.DB);

    await Promise.all([
      logService.create({
        userId,
        tokenId,
        channelId: channel.id,
        model: body.model,
        promptTokens,
        completionTokens: 0,
        quota: promptTokens,
        requestId,
        statusCode: response.status,
      }),
      tokenService.updateUsage(tokenId, promptTokens),
      userService.updateQuota(userId, promptTokens),
    ]);

    return new Response(responseBody, {
      status: response.status,
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Id': requestId,
      },
    });
  } catch (err) {
    console.error(`[${requestId}] Embeddings error:`, err);
    return c.json(
      {
        error: {
          message: 'Failed to connect to upstream',
          type: 'server_error',
          code: 'upstream_error',
        },
      },
      502
    );
  }
});

export default relay;
