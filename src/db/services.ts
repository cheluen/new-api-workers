import type { D1Database } from '@cloudflare/workers-types';
import type { User, Token, Channel, Log } from '../types';
import { hashPassword, verifyPassword } from '../utils';
import { UserStatus, TokenStatus, ChannelStatus } from '../types';

export class UserService {
  constructor(private db: D1Database) {}

  async findById(id: number): Promise<User | null> {
    const stmt = this.db.prepare('SELECT * FROM users WHERE id = ?').bind(id);
    return stmt.first<User>();
  }

  async findByUsername(username: string): Promise<User | null> {
    const stmt = this.db.prepare('SELECT * FROM users WHERE username = ?').bind(username);
    return stmt.first<User>();
  }

  async create(data: {
    username: string;
    password: string;
    displayName?: string;
    email?: string;
    role?: number;
    quota?: number;
  }): Promise<number> {
    const passwordHash = await hashPassword(data.password);
    const stmt = this.db
      .prepare(
        `INSERT INTO users (username, password_hash, display_name, email, role, quota)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(
        data.username,
        passwordHash,
        data.displayName || data.username,
        data.email || '',
        data.role || 1,
        data.quota || 0
      );

    const result = await stmt.run();
    return result.meta.last_row_id as number;
  }

  async verifyCredentials(username: string, password: string): Promise<User | null> {
    const user = await this.findByUsername(username);
    if (!user) {
      return null;
    }

    if (user.status !== UserStatus.ENABLED) {
      return null;
    }

    const isValid = await verifyPassword(password, user.password_hash);
    return isValid ? user : null;
  }

  async updatePassword(userId: number, newPassword: string): Promise<void> {
    const passwordHash = await hashPassword(newPassword);
    const stmt = this.db
      .prepare('UPDATE users SET password_hash = ?, updated_at = datetime("now") WHERE id = ?')
      .bind(passwordHash, userId);
    await stmt.run();
  }

  async updateQuota(userId: number, delta: number): Promise<void> {
    const stmt = this.db
      .prepare(
        `UPDATE users SET used_quota = used_quota + ?, request_count = request_count + 1,
         updated_at = datetime("now") WHERE id = ?`
      )
      .bind(delta, userId);
    await stmt.run();
  }

  async list(limit: number = 50, offset: number = 0): Promise<User[]> {
    const stmt = this.db
      .prepare('SELECT * FROM users ORDER BY id DESC LIMIT ? OFFSET ?')
      .bind(limit, offset);
    const result = await stmt.all<User>();
    return result.results;
  }

  async delete(id: number): Promise<void> {
    const stmt = this.db.prepare('DELETE FROM users WHERE id = ?').bind(id);
    await stmt.run();
  }

  async updateStatus(id: number, status: number): Promise<void> {
    const stmt = this.db
      .prepare('UPDATE users SET status = ?, updated_at = datetime("now") WHERE id = ?')
      .bind(status, id);
    await stmt.run();
  }
}

export class TokenService {
  constructor(private db: D1Database) {}

  async findById(id: number): Promise<Token | null> {
    const stmt = this.db.prepare('SELECT * FROM tokens WHERE id = ?').bind(id);
    return stmt.first<Token>();
  }

  async findByKey(key: string): Promise<Token | null> {
    const stmt = this.db.prepare('SELECT * FROM tokens WHERE key = ?').bind(key);
    return stmt.first<Token>();
  }

  async findByUserId(userId: number): Promise<Token[]> {
    const stmt = this.db
      .prepare('SELECT * FROM tokens WHERE user_id = ? ORDER BY id DESC')
      .bind(userId);
    const result = await stmt.all<Token>();
    return result.results;
  }

  async create(data: {
    userId: number;
    key: string;
    name: string;
    quota?: number;
    models?: string;
    expiredAt?: string | null;
  }): Promise<number> {
    const stmt = this.db
      .prepare(
        `INSERT INTO tokens (user_id, key, name, quota, models, expired_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(
        data.userId,
        data.key,
        data.name,
        data.quota || 0,
        data.models || '',
        data.expiredAt || null
      );

    const result = await stmt.run();
    return result.meta.last_row_id as number;
  }

  async validateAndGet(key: string): Promise<Token | null> {
    const token = await this.findByKey(key);
    if (!token) {
      return null;
    }

    if (token.status !== TokenStatus.ENABLED) {
      return null;
    }

    if (token.expired_at) {
      const expiry = new Date(token.expired_at);
      if (expiry < new Date()) {
        await this.updateStatus(token.id, TokenStatus.EXPIRED);
        return null;
      }
    }

    if (token.quota > 0 && token.used_quota >= token.quota) {
      return null;
    }

    return token;
  }

  async updateUsage(tokenId: number, quota: number): Promise<void> {
    const stmt = this.db
      .prepare(
        `UPDATE tokens SET used_quota = used_quota + ?, request_count = request_count + 1,
         updated_at = datetime("now") WHERE id = ?`
      )
      .bind(quota, tokenId);
    await stmt.run();
  }

  async updateStatus(id: number, status: number): Promise<void> {
    const stmt = this.db
      .prepare('UPDATE tokens SET status = ?, updated_at = datetime("now") WHERE id = ?')
      .bind(status, id);
    await stmt.run();
  }

  async delete(id: number): Promise<void> {
    const stmt = this.db.prepare('DELETE FROM tokens WHERE id = ?').bind(id);
    await stmt.run();
  }
}

export class ChannelService {
  constructor(private db: D1Database) {}

  async findById(id: number): Promise<Channel | null> {
    const stmt = this.db.prepare('SELECT * FROM channels WHERE id = ?').bind(id);
    return stmt.first<Channel>();
  }

  async findEnabled(): Promise<Channel[]> {
    const stmt = this.db
      .prepare('SELECT * FROM channels WHERE status = ? ORDER BY priority DESC, weight DESC')
      .bind(ChannelStatus.ENABLED);
    const result = await stmt.all<Channel>();
    return result.results;
  }

  async findEnabledForModel(model: string): Promise<Channel[]> {
    const channels = await this.findEnabled();
    return channels.filter((ch) => {
      if (!ch.models || ch.models.trim() === '') {
        return true;
      }
      const models = ch.models.split(',').map((m) => m.trim());
      return models.includes(model) || models.includes('*');
    });
  }

  async create(data: {
    name: string;
    type: number;
    key: string;
    baseUrl: string;
    models?: string;
    modelMapping?: string;
    priority?: number;
    weight?: number;
  }): Promise<number> {
    const stmt = this.db
      .prepare(
        `INSERT INTO channels (name, type, key, base_url, models, model_mapping, priority, weight)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        data.name,
        data.type,
        data.key,
        data.baseUrl,
        data.models || '',
        data.modelMapping || '{}',
        data.priority || 0,
        data.weight || 1
      );

    const result = await stmt.run();
    return result.meta.last_row_id as number;
  }

  async update(
    id: number,
    data: Partial<{
      name: string;
      type: number;
      key: string;
      baseUrl: string;
      models: string;
      modelMapping: string;
      status: number;
      priority: number;
      weight: number;
    }>
  ): Promise<void> {
    const fields: string[] = [];
    const values: (string | number)[] = [];

    if (data.name !== undefined) {
      fields.push('name = ?');
      values.push(data.name);
    }
    if (data.type !== undefined) {
      fields.push('type = ?');
      values.push(data.type);
    }
    if (data.key !== undefined) {
      fields.push('key = ?');
      values.push(data.key);
    }
    if (data.baseUrl !== undefined) {
      fields.push('base_url = ?');
      values.push(data.baseUrl);
    }
    if (data.models !== undefined) {
      fields.push('models = ?');
      values.push(data.models);
    }
    if (data.modelMapping !== undefined) {
      fields.push('model_mapping = ?');
      values.push(data.modelMapping);
    }
    if (data.status !== undefined) {
      fields.push('status = ?');
      values.push(data.status);
    }
    if (data.priority !== undefined) {
      fields.push('priority = ?');
      values.push(data.priority);
    }
    if (data.weight !== undefined) {
      fields.push('weight = ?');
      values.push(data.weight);
    }

    if (fields.length === 0) {
      return;
    }

    fields.push('updated_at = datetime("now")');
    values.push(id);

    const sql = `UPDATE channels SET ${fields.join(', ')} WHERE id = ?`;
    const stmt = this.db.prepare(sql).bind(...values);
    await stmt.run();
  }

  async delete(id: number): Promise<void> {
    const stmt = this.db.prepare('DELETE FROM channels WHERE id = ?').bind(id);
    await stmt.run();
  }

  async list(limit: number = 50, offset: number = 0): Promise<Channel[]> {
    const stmt = this.db
      .prepare('SELECT * FROM channels ORDER BY id DESC LIMIT ? OFFSET ?')
      .bind(limit, offset);
    const result = await stmt.all<Channel>();
    return result.results;
  }

  selectChannel(channels: Channel[]): Channel | null {
    if (channels.length === 0) {
      return null;
    }

    const totalWeight = channels.reduce((sum, ch) => sum + ch.weight, 0);
    let random = Math.random() * totalWeight;

    for (const channel of channels) {
      random -= channel.weight;
      if (random <= 0) {
        return channel;
      }
    }

    return channels[0];
  }
}

export class LogService {
  constructor(private db: D1Database) {}

  async create(data: {
    userId: number;
    tokenId: number;
    channelId: number;
    model: string;
    promptTokens: number;
    completionTokens: number;
    quota: number;
    requestId: string;
    statusCode: number;
  }): Promise<void> {
    const stmt = this.db
      .prepare(
        `INSERT INTO logs (user_id, token_id, channel_id, model, prompt_tokens, completion_tokens, quota, request_id, status_code)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        data.userId,
        data.tokenId,
        data.channelId,
        data.model,
        data.promptTokens,
        data.completionTokens,
        data.quota,
        data.requestId,
        data.statusCode
      );
    await stmt.run();
  }

  async findByUserId(userId: number, limit: number = 50, offset: number = 0): Promise<Log[]> {
    const stmt = this.db
      .prepare('SELECT * FROM logs WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?')
      .bind(userId, limit, offset);
    const result = await stmt.all<Log>();
    return result.results;
  }

  async countByUserId(userId: number): Promise<number> {
    const stmt = this.db
      .prepare('SELECT COUNT(*) as count FROM logs WHERE user_id = ?')
      .bind(userId);
    const result = await stmt.first<{ count: number }>();
    return result?.count || 0;
  }
}

export class OptionService {
  constructor(private db: D1Database) {}

  async get(key: string): Promise<string | null> {
    const stmt = this.db.prepare('SELECT value FROM options WHERE key = ?').bind(key);
    const result = await stmt.first<{ value: string }>();
    return result?.value || null;
  }

  async set(key: string, value: string): Promise<void> {
    const stmt = this.db
      .prepare('INSERT OR REPLACE INTO options (key, value) VALUES (?, ?)')
      .bind(key, value);
    await stmt.run();
  }

  async getAll(): Promise<Record<string, string>> {
    const stmt = this.db.prepare('SELECT key, value FROM options');
    const result = await stmt.all<{ key: string; value: string }>();
    const options: Record<string, string> = {};
    for (const row of result.results) {
      options[row.key] = row.value;
    }
    return options;
  }

  async getBool(key: string, defaultValue: boolean = false): Promise<boolean> {
    const value = await this.get(key);
    if (value === null) {
      return defaultValue;
    }
    return value === 'true' || value === '1';
  }

  async getInt(key: string, defaultValue: number = 0): Promise<number> {
    const value = await this.get(key);
    if (value === null) {
      return defaultValue;
    }
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
  }
}
