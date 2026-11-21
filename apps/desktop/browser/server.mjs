// The Node process, Pi sessions and all file access stay inside the container.
import { createDesktopBackend } from '../src/main/createDesktopBackend.ts';
import { DesktopSettingsStore } from '../src/main/settings/DesktopSettingsStore.ts';
import { serveWorkspaceFile } from './workspace-files.mjs';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, mkdir, readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import {
  join,
  extname,
  dirname,
  resolve,
  relative,
  isAbsolute,
} from 'node:path';
import { createInterface } from 'node:readline';

async function start(settings) {
  const clients = new Set();
  const actions = new Map();
  const visible = new Set();
  const pending = new Map();
  const dialogs = new Map();
  const channels = new Set([
    'frostpi:client:in',
    'frostpi:projects:request',
    'frostpi:resume:request',
    'frostpi:dialog:response',
  ]);
  const frame = (channel, value) =>
    'data: ' + JSON.stringify([channel, value]) + '\n\n';
  function publish(channel, value) {
    if (channel === 'frostpi:dialog:view') dialogs.set(channel, value);
    for (const client of clients) client.write(frame(channel, value));
    return clients.size > 0;
  }
  function register(collection, key, value) {
    collection.set(key, value);
    return () => collection.delete(key);
  }
  const transport = {
    publish,
    visible: () => clients.size > 0,
    listen: (channel, cb) => register(actions, channel, cb),
    handle: () => () => {},
    onVisibility(cb) {
      visible.add(cb);
      return () => visible.delete(cb);
    },
  };
  function ask(question) {
    const id = randomUUID();
    const dialog = { native: true, id, ...question };
    dialogs.set('browser:dialog', dialog);
    publish('browser:dialog', dialog);
    return new Promise((resolve) =>
      pending.set(id, (value) => {
        pending.delete(id);
        dialogs.delete('browser:dialog');
        publish('browser:dialog', null);
        resolve(typeof value === 'string' ? value : undefined);
      }),
    );
  }
  const unavailable = () => {
    throw new Error('This action requires the desktop app.');
  };
  const native = {
    focused: transport.visible,
    appearance() {},
    async confirm(_level, title, options) {
      const answer = await ask({
        title,
        items: options.map((label) => ({ id: label, label })),
      });
      return options.includes(answer) ? answer : undefined;
    },
    message: (_level, message) => publish('browser:message', message),
    async openFiles() {
      const answer = await ask({
        kind: 'input',
        title: 'Open a saved Pi chat',
        prompt:
          'Enter the path to a .jsonl chat file in the workspace or the Pi sessions folder.',
      });
      if (!answer) return;
      const path = await realpath(resolve(settings.cwd, answer));
      const roots = ['/workspace', join(homedir(), '.pi/agent/sessions')];
      if (
        !roots.some((root) => {
          const name = relative(root, path);
          return name !== '..' && !name.startsWith('../') && !isAbsolute(name);
        }) ||
        extname(path) !== '.jsonl' ||
        !(await stat(path)).isFile()
      )
        throw new Error(
          'Choose a .jsonl chat file in the workspace or Pi sessions folder.',
        );
      return [path];
    },
    chooseDirectory: () => undefined,
    openPath: () => 'Open the file in your sandbox editor.',
    launch: unavailable,
    updates: unavailable,
    writeClipboard: (text) => publish('browser:clipboard', text),
    openExternal: (url) => {
      if (['http:', 'https:'].includes(new URL(url).protocol))
        publish('browser:link', url);
    },
  };
  const profile = join(homedir(), '.pi/frostpi-web');
  const settingsStore = await DesktopSettingsStore.open(
    join(profile, 'settings.json'),
  );
  if (settingsStore.firstRun) {
    await settingsStore.replace({
      'frostpi.pi.executable': '/usr/local/bin/pi',
      'frostpi.questionTool.enabled': false,
    });
  }
  const backend = await createDesktopBackend({
    native,
    transport,
    artifacts: __dirname,
    directories: [settings.cwd],
    profile,
    settingsStore,
    clientVersion: 'FrostPi browser',
  });
  const socket = settings.socket;
  const base = '/' + settings.link + '/';
  const origin = 'http://' + settings.authority;
  const types = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.ttf': 'font/ttf',
    '.woff2': 'font/woff2',
  };
  const assets = new Map();
  async function index(directory, prefix) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await index(path, prefix + entry.name + '/');
      if (entry.isFile()) assets.set(prefix + entry.name, path);
    }
  }
  await index(join(__dirname, 'public'), base);
  assets.set(base, assets.get(base + 'index.html'));
  async function handle(req, res) {
    const fail = (status) => {
      res.writeHead(status);
      res.end();
    };
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    if (req.headers.host !== settings.authority || !req.url.startsWith(base))
      return fail(403);
    if (req.method === 'POST' && req.url === base + 'request') {
      if (
        req.headers.origin !== origin ||
        req.headers['content-type'] !== 'application/json'
      )
        return fail(403);
      const parts = [];
      for await (const part of req) parts.push(part);
      const { channel, args } = JSON.parse(Buffer.concat(parts).toString());
      if (!Array.isArray(args)) return fail(400);
      if (channel === 'browser:response') pending.get(args[0])?.(args[1]);
      else if (channels.has(channel)) actions.get(channel)?.(...args);
      else return fail(403);
      return fail(204);
    }
    if (req.url.split('?', 1)[0] === base + 'files') {
      if (req.headers['sec-fetch-site'] === 'cross-site') return fail(403);
      if (req.method === 'POST' && req.headers.origin !== origin) return fail(403);
      return serveWorkspaceFile(new URL(req.url, origin).searchParams, req, res, settings);
    }
    if (req.method !== 'GET') return fail(405);
    if (req.url === base + 'events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(': connected\n\n');
      clients.add(res);
      if (clients.size === 1) for (const fn of visible) fn(true);
      for (const [channel, value] of dialogs)
        if (value) res.write(frame(channel, value));
      const heartbeat = setInterval(() => res.write(': connected\n\n'), 15000);
      res.on('close', () => {
        clearInterval(heartbeat);
        clients.delete(res);
        if (!clients.size) for (const fn of visible) fn(false);
      });
      return;
    }
    const path = assets.get(req.url.split('?', 1)[0]);
    if (!path) return fail(404);
    res.writeHead(200, {
      'Content-Length': (await stat(path)).size,
      'Content-Type': types[extname(path)] ?? 'application/octet-stream',
    });
    createReadStream(path)
      .on('error', () => res.destroy())
      .pipe(res);
  }
  const server = createServer((req, res) =>
    handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(400);
      res.end();
    }),
  );
  await mkdir(dirname(socket), { recursive: true, mode: 0o700 });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socket, resolve);
  });
  await chmod(socket, 0o600);
  process.stdout.write('ready\n');
  return async () => {
    for (const client of clients) client.end();
    server.close();
    server.closeAllConnections();
    for (const answer of pending.values()) answer(null);
    await backend.dispose();
  };
}
const input = createInterface({ input: process.stdin });
input.once('line', (line) => {
  const started = start(JSON.parse(line));
  let stopping;
  const stop = () =>
    (stopping ??= started
      .then((close) => close())
      .then(() => process.exit(0))
      .catch(() => process.exit(1)));
  input.once('close', stop);
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  started.catch((error) => {
    console.error('FrostPi startup failed:', error.message);
    process.exit(1);
  });
});
