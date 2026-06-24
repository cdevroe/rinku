const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

function parseScalar(value) {
  const trimmed = String(value || '').trim();

  if (trimmed === '') {
    return '';
  }

  if (trimmed === 'null') {
    return null;
  }

  if (trimmed === 'true') {
    return true;
  }

  if (trimmed === 'false') {
    return false;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

function serializeScalar(value) {
  if (value === undefined) {
    return undefined;
  }

  return JSON.stringify(value);
}

function parseFrontmatter(rawContent) {
  const content = String(rawContent || '');
  const match = content.match(FRONTMATTER_RE);

  if (!match) {
    return {
      frontmatter: {},
      body: content,
    };
  }

  const frontmatter = {};
  const yaml = match[1] || '';
  for (const line of yaml.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const colonIndex = trimmed.indexOf(':');
    if (colonIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, colonIndex).trim();
    const value = trimmed.slice(colonIndex + 1).trim();
    if (key) {
      frontmatter[key] = parseScalar(value);
    }
  }

  return {
    frontmatter,
    body: content.slice(match[0].length),
  };
}

function serializeFrontmatter(frontmatter = {}, body = '', keyOrder = []) {
  const source = frontmatter && typeof frontmatter === 'object' && !Array.isArray(frontmatter)
    ? frontmatter
    : {};
  const keys = [];
  const seen = new Set();

  for (const key of keyOrder) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      keys.push(key);
      seen.add(key);
    }
  }

  for (const key of Object.keys(source).sort((a, b) => a.localeCompare(b))) {
    if (!seen.has(key)) {
      keys.push(key);
    }
  }

  const lines = [];
  for (const key of keys) {
    const value = serializeScalar(source[key]);
    if (value !== undefined) {
      lines.push(`${key}: ${value}`);
    }
  }

  return `---\n${lines.join('\n')}\n---\n${String(body || '')}`;
}

module.exports = {
  parseFrontmatter,
  serializeFrontmatter,
};

