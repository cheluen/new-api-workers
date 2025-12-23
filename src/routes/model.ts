import { Hono } from 'hono';
import type { CloudflareBindings, JwtPayload } from '../types';
import { jwtAuth, requireAdmin } from '../middleware';

type Variables = {
  jwtPayload: JwtPayload;
  userId: number;
  userRole: number;
};

const model = new Hono<{ Bindings: CloudflareBindings; Variables: Variables }>();

model.use('/*', jwtAuth());
model.use('/*', requireAdmin());

// GET /api/models/ - 获取模型元数据列表
model.get('/', async (c) => {
  const page = parseInt(c.req.query('p') || '1', 10);
  const pageSize = parseInt(c.req.query('page_size') || '20', 10);
  const offset = (page - 1) * pageSize;

  try {
    const stmt = c.env.DB.prepare(`
      SELECT * FROM model_metadata
      ORDER BY id DESC
      LIMIT ? OFFSET ?
    `).bind(pageSize, offset);

    const result = await stmt.all();

    // 获取总数
    const countStmt = c.env.DB.prepare('SELECT COUNT(*) as total FROM model_metadata');
    const countResult = await countStmt.first() as { total: number } | null;

    return c.json({
      success: true,
      message: '',
      data: {
        items: result.results || [],
        total: countResult?.total || 0,
        page,
        page_size: pageSize,
      },
    });
  } catch (err) {
    console.error('Error fetching models:', err);
    // 如果表不存在，返回空数据
    return c.json({
      success: true,
      message: '',
      data: {
        items: [],
        total: 0,
        page,
        page_size: pageSize,
      },
    });
  }
});

// GET /api/models/search - 搜索模型
model.get('/search', async (c) => {
  const keyword = c.req.query('keyword') || '';
  const vendor = c.req.query('vendor') || '';
  const page = parseInt(c.req.query('p') || '1', 10);
  const pageSize = parseInt(c.req.query('page_size') || '20', 10);
  const offset = (page - 1) * pageSize;

  try {
    let sql = `SELECT * FROM model_metadata WHERE 1=1`;
    const params: (string | number)[] = [];

    if (keyword) {
      sql += ` AND (model_id LIKE ? OR model_name LIKE ?)`;
      params.push(`%${keyword}%`, `%${keyword}%`);
    }
    if (vendor) {
      sql += ` AND vendor = ?`;
      params.push(vendor);
    }

    sql += ` ORDER BY id DESC LIMIT ? OFFSET ?`;
    params.push(pageSize, offset);

    const stmt = c.env.DB.prepare(sql).bind(...params);
    const result = await stmt.all();

    return c.json({
      success: true,
      message: '',
      data: {
        items: result.results || [],
        total: result.results?.length || 0,
        page,
        page_size: pageSize,
      },
    });
  } catch (err) {
    console.error('Error searching models:', err);
    return c.json({
      success: true,
      message: '',
      data: {
        items: [],
        total: 0,
        page,
        page_size: pageSize,
      },
    });
  }
});

// GET /api/models/missing - 获取未配置模型
model.get('/missing', async (c) => {
  // 从渠道获取已启用的模型，与model_metadata对比
  const { ChannelService } = await import('../db');
  const channelService = new ChannelService(c.env.DB);
  const channels = await channelService.findEnabled();

  const enabledModels = new Set<string>();
  for (const ch of channels) {
    if (ch.models) {
      const models = ch.models.split(',').map((m: string) => m.trim());
      for (const model of models) {
        if (model && model !== '*') {
          enabledModels.add(model);
        }
      }
    }
  }

  try {
    // 获取已配置的模型
    const stmt = c.env.DB.prepare('SELECT model_id FROM model_metadata');
    const result = await stmt.all();
    const configuredModels = new Set(
      (result.results || []).map((r: Record<string, unknown>) => String(r.model_id))
    );

    // 找出未配置的模型
    const missingModels = Array.from(enabledModels).filter(
      (m) => !configuredModels.has(m)
    );

    return c.json({
      success: true,
      message: '',
      data: missingModels.map((m) => ({ model_id: m })),
    });
  } catch (err) {
    console.error('Error fetching missing models:', err);
    return c.json({
      success: true,
      message: '',
      data: Array.from(enabledModels).map((m) => ({ model_id: m })),
    });
  }
});

// GET /api/models/sync_upstream/preview - 预览上游同步（简化版返回空）
model.get('/sync_upstream/preview', async (c) => {
  return c.json({
    success: true,
    message: '',
    data: {
      new_models: [],
      updated_models: [],
      conflicts: [],
    },
  });
});

// POST /api/models/sync_upstream - 执行上游同步（简化版不做任何操作）
model.post('/sync_upstream', async (c) => {
  return c.json({
    success: true,
    message: 'Sync completed (no upstream configured)',
    data: {
      synced: 0,
    },
  });
});

// GET /api/models/:id - 获取单个模型
model.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);

  try {
    const stmt = c.env.DB.prepare('SELECT * FROM model_metadata WHERE id = ?').bind(id);
    const result = await stmt.first();

    if (!result) {
      return c.json({ success: false, message: 'Model not found' }, 404);
    }

    return c.json({
      success: true,
      message: '',
      data: result,
    });
  } catch (err) {
    console.error('Error fetching model:', err);
    return c.json({ success: false, message: 'Model not found' }, 404);
  }
});

// POST /api/models/ - 创建模型元数据
model.post('/', async (c) => {
  const body = await c.req.json<{
    model_id: string;
    model_name?: string;
    vendor?: string;
    tags?: string;
    status?: number;
    input_price?: number;
    output_price?: number;
    context_size?: number;
  }>();

  if (!body.model_id) {
    return c.json({ success: false, message: 'model_id is required' }, 400);
  }

  try {
    const stmt = c.env.DB.prepare(`
      INSERT INTO model_metadata (model_id, model_name, vendor, tags, status, input_price, output_price, context_size, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime("now"), datetime("now"))
    `).bind(
      body.model_id,
      body.model_name || body.model_id,
      body.vendor || '',
      body.tags || '',
      body.status ?? 1,
      body.input_price || 0,
      body.output_price || 0,
      body.context_size || 0
    );

    const result = await stmt.run();

    return c.json({
      success: true,
      message: 'Model created',
      data: { id: result.meta?.last_row_id },
    });
  } catch (err) {
    console.error('Error creating model:', err);
    return c.json({ success: false, message: 'Failed to create model' }, 500);
  }
});

// PUT /api/models/ - 更新模型元数据
model.put('/', async (c) => {
  const statusOnly = c.req.query('status_only') === 'true';
  const body = await c.req.json<{
    id: number;
    model_id?: string;
    model_name?: string;
    vendor?: string;
    tags?: string;
    status?: number;
    input_price?: number;
    output_price?: number;
    context_size?: number;
  }>();

  if (!body.id) {
    return c.json({ success: false, message: 'id is required' }, 400);
  }

  try {
    if (statusOnly) {
      // 仅更新状态
      const stmt = c.env.DB.prepare(`
        UPDATE model_metadata SET status = ?, updated_at = datetime("now") WHERE id = ?
      `).bind(body.status ?? 1, body.id);
      await stmt.run();
    } else {
      // 更新所有字段
      const fields: string[] = [];
      const values: (string | number)[] = [];

      if (body.model_id !== undefined) {
        fields.push('model_id = ?');
        values.push(body.model_id);
      }
      if (body.model_name !== undefined) {
        fields.push('model_name = ?');
        values.push(body.model_name);
      }
      if (body.vendor !== undefined) {
        fields.push('vendor = ?');
        values.push(body.vendor);
      }
      if (body.tags !== undefined) {
        fields.push('tags = ?');
        values.push(body.tags);
      }
      if (body.status !== undefined) {
        fields.push('status = ?');
        values.push(body.status);
      }
      if (body.input_price !== undefined) {
        fields.push('input_price = ?');
        values.push(body.input_price);
      }
      if (body.output_price !== undefined) {
        fields.push('output_price = ?');
        values.push(body.output_price);
      }
      if (body.context_size !== undefined) {
        fields.push('context_size = ?');
        values.push(body.context_size);
      }

      if (fields.length > 0) {
        fields.push('updated_at = datetime("now")');
        values.push(body.id);
        const sql = `UPDATE model_metadata SET ${fields.join(', ')} WHERE id = ?`;
        await c.env.DB.prepare(sql).bind(...values).run();
      }
    }

    return c.json({ success: true, message: 'Model updated' });
  } catch (err) {
    console.error('Error updating model:', err);
    return c.json({ success: false, message: 'Failed to update model' }, 500);
  }
});

// DELETE /api/models/:id - 删除模型
model.delete('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);

  try {
    const stmt = c.env.DB.prepare('DELETE FROM model_metadata WHERE id = ?').bind(id);
    await stmt.run();

    return c.json({ success: true, message: 'Model deleted' });
  } catch (err) {
    console.error('Error deleting model:', err);
    return c.json({ success: false, message: 'Failed to delete model' }, 500);
  }
});

export default model;
