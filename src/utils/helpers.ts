export function generateApiKey(prefix: string = 'sk'): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${prefix}-${hex}`;
}

export function parseAuthHeader(header: string | undefined): string | null {
  if (!header) {
    return null;
  }

  if (header.startsWith('Bearer ')) {
    return header.slice(7);
  }

  return header;
}

export function parseModelsString(models: string): string[] {
  if (!models || models.trim() === '') {
    return [];
  }
  return models
    .split(',')
    .map((m) => m.trim())
    .filter((m) => m.length > 0);
}

export function modelsToString(models: string[]): string {
  return models.join(',');
}

export function isModelAllowed(model: string, allowedModels: string): boolean {
  if (!allowedModels || allowedModels.trim() === '') {
    return true;
  }
  const allowed = parseModelsString(allowedModels);
  return allowed.includes(model) || allowed.includes('*');
}

export function sanitizeForLog(obj: Record<string, unknown>): Record<string, unknown> {
  const sanitized = { ...obj };
  const sensitiveKeys = ['password', 'key', 'secret', 'token', 'authorization'];

  for (const key of Object.keys(sanitized)) {
    if (sensitiveKeys.some((s) => key.toLowerCase().includes(s))) {
      sanitized[key] = '[REDACTED]';
    }
  }

  return sanitized;
}
