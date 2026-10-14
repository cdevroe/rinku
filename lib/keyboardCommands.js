// Shared by the native menu and the renderer's shortcut reference.
(function () {
  const commands = [
    { id: 'add-link', label: 'Add Link', accelerator: 'CommandOrControl+N', group: 'File' },
    { id: 'settings', label: 'Settings', accelerator: 'CommandOrControl+,', group: 'File' },
    { id: 'search', label: 'Search Links', accelerator: 'CommandOrControl+F', group: 'Navigate' },
    { id: 'focus-list', label: 'Focus Link List', accelerator: 'CommandOrControl+L', group: 'Navigate' },
    { id: 'all-links', label: 'All Active Links', accelerator: 'CommandOrControl+1', group: 'Navigate' },
    { id: 'switch-status', label: 'Switch Active / Archive', accelerator: 'CommandOrControl+Shift+A', group: 'Navigate' },
    { id: 'labels', label: 'Filter by Label', accelerator: 'CommandOrControl+Shift+L', group: 'Navigate' },
    { id: 'contexts', label: 'Filter by Context', accelerator: 'CommandOrControl+Shift+C', group: 'Navigate' },
    { id: 'tags', label: 'Filter by Tag', accelerator: 'CommandOrControl+Shift+T', group: 'Navigate' },
    { id: 'link-info', label: 'Link Information', accelerator: 'CommandOrControl+I', group: 'Link' },
    // Enter belongs to the focused list, so it must not be a global menu accelerator.
    { id: 'open-link', label: 'Open Link in Browser', shortcut: 'Enter', group: 'Link' },
    { id: 'archive-link', label: 'Archive / Restore Link', accelerator: 'CommandOrControl+Shift+E', group: 'Link' },
    { id: 'shortcuts', label: 'Keyboard Shortcuts', accelerator: 'CommandOrControl+/', group: 'Help' },
  ];
  if (typeof module !== 'undefined' && module.exports) module.exports = commands;
  else window.rinkuKeyboardCommands = commands;
}());
