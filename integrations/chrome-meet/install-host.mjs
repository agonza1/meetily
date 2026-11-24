import { access, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { constants } from 'node:fs';

const [id, executable] = process.argv.slice(2);
if (process.platform !== 'darwin' || !/^[a-p]{32}$/.test(id) || !executable || !isAbsolute(executable)) {
  throw new Error('Usage on macOS: node install-host.mjs <Chrome extension ID> <absolute path to Meetily executable>');
}
await access(executable, constants.X_OK);
const directory = join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts');
await mkdir(directory, { recursive: true });
const manifest = join(directory, 'com.meetily.google_meet.json');
await writeFile(manifest, JSON.stringify({
  name: 'com.meetily.google_meet',
  description: 'Meetily local Google Meet detector',
  path: executable,
  type: 'stdio',
  allowed_origins: [`chrome-extension://${id}/`],
}, null, 2), { flag: 'wx', mode: 0o600 });
console.log(`Registered local native host: ${manifest}`);
