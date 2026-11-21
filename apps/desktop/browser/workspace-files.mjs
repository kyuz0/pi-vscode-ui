// Runs only in the standalone browser server inside the Linux sandbox.
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, open, readdir, readlink, unlink } from 'node:fs/promises';
import { basename, resolve, sep } from 'node:path';
import { detectRasterImageMimeType } from '../../pi-client/src/host/bridge/markdown-images/detectRasterImageMimeType.ts';
import { pipeline } from 'node:stream/promises';

const workspace = '/workspace';
const pageBytes = 64 * 1024; // Text is read a page at a time. The viewer can request the rest.
const insideWorkspace = (path) => path === workspace || path.startsWith(workspace + sep);

async function receiveFile(directory, name, req) {
  // Stage beside the destination. The hard link publishes all bytes in one step
  // and fails if another upload or process has already created this name.
  const temporary = directory + '/.frostpi-' + randomUUID() + '.part';
  const file = await open(temporary, 'wx', 0o600);
  try {
    await file.writeFile(req);
    if (!req.complete) throw new Error('Upload interrupted');
    await link(temporary, directory + '/' + name);
  } finally {
    await file.close();
    await unlink(temporary);
  }
}

export async function serveWorkspaceFile(params, req, res, settings) {
  res.setHeader(
    'Content-Security-Policy',
    "sandbox; default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  );
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  let downloadable = false;
  function json(value, status = 200) {
    if (downloadable && value.kind) value.download = true;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(value));
  }
  const uploading = req.method === 'POST';
  if (!uploading && req.method !== 'GET') return json({ error: 'Unsupported method.' }, 405);
  if (uploading && !settings.uploads) return json({ error: 'Uploads are off for this editor.' }, 403);
  if (params.has('download') && !settings.downloads)
    return json({ error: 'Downloads are off for this editor.' }, 403);
  const path = resolve(workspace, params.get('path') ?? '');
  if (!insideWorkspace(path)) return json({ error: 'This file is outside the workspace.' }, 403);
  let target, file;
  try {
    // O_PATH pins the target without opening a device, FIFO or file for reading.
    // Read from that same inode after checking its resolved location, even if a link changes.
    target = await open(path, 0o10000000); // Linux O_PATH, absent from Node's fs.constants.
    const descriptor = '/proc/self/fd/' + target.fd;
    if (!insideWorkspace(await readlink(descriptor)))
      return json({ error: 'This link points outside the workspace.' }, 403);
    const info = await target.stat();
    const location = path.slice(workspace.length + 1);
    if (uploading) {
      const name = params.get('name');
      if (!info.isDirectory() || !name || name === '.' || name === '..' || /[\/\\\x00-\x1f\x7f]/.test(name))
        return json({ error: 'Choose a file with a valid name and a workspace folder.' }, 400);
      if (req.headers['content-type'] !== 'application/octet-stream')
        return json({ error: 'Choose a file to upload.' }, 415);
      await receiveFile(descriptor, name, req);
      return json({ name }, 201);
    }
    if (info.isDirectory()) {
      if (params.has('download')) return json({ error: 'Choose a file to download.' }, 400);
      const entries = await readdir(descriptor, { withFileTypes: true });
      const items = entries.map((entry) => ({
        name: entry.name,
        kind: entry.isDirectory() ? 'folder' : entry.isSymbolicLink() ? 'link' : 'file',
      }));
      items.sort(
        (a, b) => Number(b.kind === 'folder') - Number(a.kind === 'folder') || a.name.localeCompare(b.name),
      );
      return json({ kind: 'folder', path: location, items, upload: settings.uploads === true });
    }
    if (!info.isFile())
      return params.has('download')
        ? json({ error: 'Only regular workspace files can be downloaded.' }, 400)
        : json({ kind: 'unsupported', path: location });
    file = await open(descriptor, constants.O_RDONLY);
    downloadable = settings.downloads === true;
    if (params.has('download')) {
      const name = encodeURIComponent(basename(path)).replace(
        /['()*]/g,
        (c) => '%' + c.charCodeAt(0).toString(16),
      );
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': "attachment; filename*=UTF-8''" + name,
      });
      await pipeline(file.createReadStream(), res);
      return;
    }
    const signature = Buffer.alloc(Math.min(512, info.size));
    await file.read(signature, 0, signature.length, 0);
    const mime = detectRasterImageMimeType(signature);
    if (params.has('image')) {
      if (!mime) return json({ error: 'This file is no longer an image.' }, 415);
      res.writeHead(200, { 'Content-Type': mime });
      await pipeline(file.createReadStream(), res);
      return;
    }
    if (mime) return json({ kind: 'image', path: location });
    const offset = Number(params.get('offset') ?? 0);
    const version = [info.dev, info.ino, info.size, info.ctimeMs].join(':');
    if (
      (params.has('version') && params.get('version') !== version) ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > info.size
    )
      return json({ error: 'The file changed. Refresh to read the latest version.' }, 409);
    const buffer = Buffer.alloc(Math.min(info.size - offset, pageBytes + 1));
    const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
    let end = Math.min(bytesRead, pageBytes);
    // Leave an incomplete UTF-8 character for the next page.
    while (end < bytesRead && end > 0 && (buffer[end] & 0xc0) === 0x80) end--;
    const bytes = buffer.subarray(0, end);
    let text;
    try {
      if ((!end && bytesRead) || bytes.some((b) => b < 32 && ![9, 10, 12, 13].includes(b))) {
        return json({ kind: 'unsupported', path: location });
      }
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return json({ kind: 'unsupported', path: location });
    }
    return json({
      kind: 'text',
      path: location,
      text,
      version,
      next: end && offset + end < info.size ? offset + end : null,
    });
  } catch (error) {
    if (res.headersSent || res.destroyed) return;
    if (uploading && error.code === 'EEXIST')
      return json(
        { error: `“${params.get('name')}” already exists in this folder. Rename your file and try again.` },
        409,
      );
    if (uploading && error.code === 'ENOSPC')
      return json({ error: 'There is not enough disk space for this upload.' }, 507);
    const missing = ['ENOENT', 'ENOTDIR'].includes(error.code);
    json(
      {
        error: missing ? 'This file or folder was not found.' : 'This file or folder could not be opened.',
      },
      missing ? 404 : 403,
    );
  } finally {
    await file?.close();
    await target?.close();
  }
}
