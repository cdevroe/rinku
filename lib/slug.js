const path = require('path');

const RESERVED_NAMES = new Set(['.', '..']);

function normalizeSpace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function sanitizeDirectoryName(value, fallback = 'Untitled') {
  const cleaned = normalizeSpace(value)
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\.+$/g, '')
    .trim();

  if (!cleaned || RESERVED_NAMES.has(cleaned)) {
    return fallback;
  }

  return cleaned;
}

function slugify(value, fallback = 'untitled') {
  const cleaned = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  return cleaned || fallback;
}

function truncateSlug(value, maxLength = 72) {
  const slug = slugify(value);
  if (slug.length <= maxLength) {
    return slug;
  }

  return slug.slice(0, maxLength).replace(/-+$/g, '') || 'untitled';
}

function hostFromUrl(url) {
  try {
    return new URL(String(url || '').trim()).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

function fileSafeHost(url) {
  const host = hostFromUrl(url);
  return host ? host.replace(/[^a-z0-9.-]+/gi, '-').replace(/^-+|-+$/g, '') : 'unknown-domain';
}

function isSafeFileName(fileName) {
  const base = path.basename(String(fileName || ''));
  return Boolean(base && base === fileName && !RESERVED_NAMES.has(base));
}

module.exports = {
  fileSafeHost,
  hostFromUrl,
  isSafeFileName,
  normalizeSpace,
  sanitizeDirectoryName,
  slugify,
  truncateSlug,
};

