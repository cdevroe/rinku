const DEFAULT_LABELS = Object.freeze([
  Object.freeze({ id: 'read', name: 'Read', color: '#f97316' }),
  Object.freeze({ id: 'watch', name: 'Watch', color: '#2563eb' }),
  Object.freeze({ id: 'listen', name: 'Listen', color: '#eab308' }),
  Object.freeze({ id: 'buy', name: 'Buy', color: '#9333ea' }),
  Object.freeze({ id: 'eat-drink', name: 'Eat & Drink', color: '#16a34a' }),
  Object.freeze({ id: 'do', name: 'Do', color: '#db2777' }),
  Object.freeze({ id: 'unlabeled', name: 'Unlabeled', color: '#64748b' }),
]);

const BUILTIN_SMART_LABEL_RULES = Object.freeze([
  ...['php.net', 'api.rubyonrails.org', 'ruby-doc.org', 'docs.jquery.com', 'codeigniter.com', 'css-tricks.com', 'developer.apple.com'].map((domain) => ({ domain, label: 'read', source: 'builtin' })),
  ...['youtube.com', 'youtu.be', 'viddler.com', 'devour.com', 'ted.com', 'vimeo.com'].map((domain) => ({ domain, label: 'watch', source: 'builtin' })),
  ...['soundcloud.com', 'spotify.com', 'music.apple.com', 'bandcamp.com', 'overcast.fm', 'podcasts.apple.com'].map((domain) => ({ domain, label: 'listen', source: 'builtin' })),
  ...['svpply.com', 'amazon.com', 'fab.com', 'zappos.com', 'thriftbooks.com', 'etsy.com', 'ebay.com'].map((domain) => ({ domain, label: 'buy', source: 'builtin' })),
  ...['simplyrecipes.com', 'allrecipes.com', 'epicurious.com', 'foodnetwork.com', 'food.com'].map((domain) => ({ domain, label: 'eat-drink', source: 'builtin' })),
]);

const DEFAULT_SETTINGS = Object.freeze({
  schemaVersion: 1,
  labels: DEFAULT_LABELS,
  contexts: Object.freeze(['@Home', '@Work']),
  smartLabels: {
    learnFromManualChanges: true,
    rules: [],
  },
  capture: {
    localHttpEnabled: false,
    localHttpPort: 47342,
  },
});

module.exports = {
  BUILTIN_SMART_LABEL_RULES,
  DEFAULT_LABELS,
  DEFAULT_SETTINGS,
};
