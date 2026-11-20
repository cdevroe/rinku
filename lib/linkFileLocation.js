const fs = require('fs').promises;
const { listLinks } = require('./library');

async function resolveLinkFile(libraryRoot, id) {
  if (!libraryRoot) throw new Error('Open a library before showing a link’s file.');
  if (typeof id !== 'string' || !id) throw new Error('Select a link first.');
  // Scan the files rather than using a cached path: labels and archive state move them.
  const { links } = await listLinks(libraryRoot, { rebuild: true, readOnly: true });
  const link = links.find(link => link.id === id);
  if (link && await fs.stat(link.filePath).then(stat => stat.isFile(), error => {
    if (error.code === 'ENOENT') return false;
    throw error;
  })) return link.filePath;
  throw new Error('This link’s Markdown file could not be found. It may have been moved or deleted.');
}

module.exports = { resolveLinkFile };
