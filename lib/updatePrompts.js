// Updater events do not wait for async listeners. Keep repeated events from
// opening another dialog while the first one is awaiting a user's choice.
function createUpdatePrompts() {
  const active = new Set();
  return {
    get busy() { return active.size > 0; },
    async run(kind, show) {
      if (active.has(kind)) return;
      active.add(kind);
      try {
        return await show();
      } finally {
        active.delete(kind);
      }
    },
  };
}

module.exports = { createUpdatePrompts };
