import { expect, test } from 'bun:test';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test.skipIf(process.platform !== 'darwin')('only helpers inside the Krisp bundle identity are excluded', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'audio-family-'));
  try {
    // Exercise the production family lookup on real PIDs without querying any audio devices.
    const probe = join(dir, 'check-family');
    const compile = Bun.spawnSync(['clang', '-Wall', '-Werror', '-x', 'c', '-', '-o', probe,
      '-I', resolve(import.meta.dir, '../../src-tauri/src/audio'), '-framework', 'CoreAudio', '-framework', 'CoreFoundation'], {
      stdin: Buffer.from('#include "process_activity.c"\n#include <stdlib.h>\nint main(int argc, char **argv) { return family(atoi(argv[1]), "") != 0; }'),
    });
    if (compile.exitCode !== 0) throw new Error(compile.stderr.toString());
    for (const [name, identifier, expected] of [
      ['Renamed', 'ai.krisp.krispMac', 0],
      ['Krisp', 'ai.krisp.krispMac.other', 1],
    ] as const) {
      const contents = join(dir, `${name}.app`, 'Contents');
      const helper = join(contents, 'Frameworks', 'Helper.app', 'Contents', 'MacOS', 'helper');
      mkdirSync(join(helper, '..'), { recursive: true });
      writeFileSync(join(contents, 'Info.plist'), `<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${identifier}</string></dict></plist>`);
      copyFileSync('/bin/sleep', helper);
      const proc = Bun.spawn([helper, '30']);
      try { expect(Bun.spawnSync([probe, String(proc.pid)]).exitCode).toBe(expected); }
      finally { proc.kill(); await proc.exited; }
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
