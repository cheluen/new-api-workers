import type { D1Database } from '@cloudflare/workers-types';

export interface CloudflareBindings {
  DB: D1Database;
  JWT_SECRET: string;
  RELAY_PROXY_URL: string;
  RELAY_PROXY_KEY: string;
  ALLOWED_ORIGINS: string;
  TOKEN_EXPIRY_HOURS: string;
}

export interface JwtPayload {
  sub: number;
  username: string;
  role: number;
  iat: number;
  exp: number;
}

export interface User {
  id: number;
  username: string;
  password_hash: string;
  display_name: string;
  email: string;
  role: number;
  status: number;
  quota: number;
  used_quota: number;
  request_count: number;
  created_at: string;
  updated_at: string;
}

export interface Token {
  id: number;
  user_id: number;
  key: string;
  name: string;
  status: number;
  quota: number;
  used_quota: number;
  request_count: number;
  models: string;
  subnet: string;
  expired_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Channel {
  id: number;
  name: string;
  type: number;
  key: string;
  base_url: string;
  models: string;
  model_mapping: string;
  status: number;
  priority: number;
  weight: number;
  created_at: string;
  updated_at: string;
}

export interface Log {
  id: number;
  user_id: number;
  token_id: number;
  channel_id: number;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  quota: number;
  created_at: string;
}

export const UserRole = {
  USER: 1,
  ADMIN: 10,
  ROOT: 100,
} as const;

export const UserStatus = {
  DISABLED: 0,
  ENABLED: 1,
} as const;

export const TokenStatus = {
  DISABLED: 0,
  ENABLED: 1,
  EXPIRED: 2,
} as const;

export const ChannelStatus = {
  DISABLED: 0,
  ENABLED: 1,
  TESTING: 2,
} as const;

export const ChannelType = {
  OPENAI: 1,
  AZURE: 3,
  ANTHROPIC: 14,
  GOOGLE: 24,
  CUSTOM: 99,
} as const;
