function errorResult(error) {
  const codes = { ENOENT: 'not_found', EACCES: 'forbidden', EPERM: 'forbidden', EEXIST: 'conflict' };
  const message = error.message || String(error);
  const inferred = /^Link not found:/.test(message) ? 'not_found' : /^Link reference is ambiguous:/.test(message) ? 'conflict'
    : /reference is required/.test(message) || error instanceof SyntaxError ? 'invalid_arguments' : 'internal_error';
  return { ok: false, error: { code: codes[error.code] || error.code || inferred, message } };
}

function outcome(value) {
  if (value?.ok !== false || value.error) return value;
  const statuses = (value.results || []).map(result => result.status);
  const partial = value.indexError || value.journalError || statuses.some(status => ['partial', 'updated', 'merged', 'deleted'].includes(status));
  const code = partial ? 'partial_failure' : statuses.length && statuses.every(status => status === 'conflict') ? 'conflict'
    : statuses.length && statuses.every(status => status === 'not_found') ? 'not_found' : 'operation_failed';
  return { ...value, error: { code, message: partial
    ? 'The operation was only partially completed. Inspect results and recovery receipts before retrying.'
    : 'The operation did not complete. Inspect the per-record results.' } };
}

module.exports = { errorResult, outcome };
