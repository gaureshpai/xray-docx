import JSZip from 'jszip';
import ZipEntries from 'jszip/lib/zipEntries.js';
import {utf8decode} from 'jszip/lib/utf8.js';

/** Validate the catalog before JSZip normalizes names and overwrites duplicates.
 * This adapter uses internals from exactly pinned JSZip 3.10.2; its regressions
 * must run when upgrading JSZip. CRC verification remains in the public loader.
 */
export async function loadArchive(bytes) {
  const catalog = new ZipEntries({decodeFileName:utf8decode});
  catalog.load(bytes);
  if (catalog.centralDirRecords !== catalog.files.length) throw new Error('Archive entry count mismatch.');
  const seen = new Set();
  for (const entry of catalog.files) {
    const name = entry.fileNameStr;
    const path = name.endsWith('/') ? name.slice(0,-1) : name;
    if (!path || name.startsWith('/') || /[\\\u0000:]/u.test(name) || path.split('/').some(segment => !segment || segment === '.' || segment === '..')) throw new Error('Unsafe archive path.');
    if (seen.has(name)) throw new Error('Duplicate archive entry.');
    seen.add(name);
  }
  return JSZip.loadAsync(bytes, {checkCRC32:true, createFolders:false});
}
