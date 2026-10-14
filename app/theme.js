// Apply the saved appearance before styles load to avoid flashing the wrong theme.
(function () {
  const storageKey = 'rinku.theme';
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
  let preference = localStorage.getItem(storageKey);
  if (!['light', 'dark', 'auto'].includes(preference)) preference = 'auto';

  function applyTheme() {
    document.documentElement.dataset.theme = preference === 'auto'
      ? (systemTheme.matches ? 'dark' : 'light')
      : preference;
  }

  function syncNativeTheme() {
    if (window.rinku?.setTheme) window.rinku.setTheme(preference).catch(console.error);
  }

  window.rinkuTheme = {
    getPreference: () => preference,
    setPreference(value) {
      if (!['light', 'dark', 'auto'].includes(value)) return;
      localStorage.setItem(storageKey, value);
      preference = value;
      applyTheme();
      syncNativeTheme();
    },
  };

  systemTheme.addEventListener('change', applyTheme);
  applyTheme();
  syncNativeTheme();
}());
