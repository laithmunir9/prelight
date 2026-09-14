(function (root) {
  const legacyName = /neutral\s*eye(?:\s+pitch)?/ig;
  const cleanName = value => String(value || '').replace(legacyName, 'Product Pitch');
  // Migrate only Prelight Studio state. Never clear unrelated storage or recordings.
  function migrate(storage) {
    try {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (!/^prelight.*(?:studio|workspace|demo)/i.test(key)) continue;
        const raw = storage.getItem(key);
        if (!raw || !/neutral\s*eye/i.test(raw)) continue;
        try {
          const visit = value => {
            if (typeof value === 'string') return cleanName(value);
            if (Array.isArray(value)) return value.map(visit);
            if (value && typeof value === 'object') {
              const oldDemo = Object.values(value).some(v => typeof v === 'string' && /neutral\s*eye/i.test(v));
              return { ...Object.fromEntries(Object.entries(value).map(([k,v]) => [k, visit(v)])), ...(oldDemo ? { demo: true } : {}) };
            }
            return value;
          };
          storage.setItem(key, JSON.stringify(visit(JSON.parse(raw))));
        } catch { storage.setItem(key, cleanName(raw)); }
      }
    } catch { /* Storage may be unavailable; the interface still works in memory. */ }
  }
  const isDemo = take => Boolean(take.demo || take.isDemo || /^demo(?:[-_]|$)/i.test(take.id || ''));
  root.StudioState = { migrate, cleanName, isDemo };
})(globalThis);
