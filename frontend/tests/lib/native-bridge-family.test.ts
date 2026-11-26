import { expect, test } from 'bun:test';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test.skipIf(process.platform !== 'darwin')('only helpers inside the Krisp bundle identity are excluded', () => {
  const dir = mkdtempSync(join(tmpdir(), 'audio-family-'));
  try {
    // Run inside each nested helper to resolve its actual outer bundle, without opening audio.
    const probe = join(dir, 'check-family');
    const compile = Bun.spawnSync(['clang', '-Wall', '-Werror', '-x', 'c', '-', '-o', probe,
      '-I', resolve(import.meta.dir, '../../src-tauri/src/audio'), '-framework', 'CoreAudio', '-framework', 'CoreFoundation'], {
      stdin: Buffer.from('#include "process_activity.c"\nint main(void) { char app[PROC_PIDPATHINFO_MAXSIZE]; if (!bundle(getpid(), app)) return 2; return is_krisp_bridge(app); }'),
    });
    if (compile.exitCode !== 0) throw new Error(compile.stderr.toString());
    for (const [name, identifier, expected] of [
      ['Renamed', 'ai.krisp.krispMac', 1],
      ['Krisp', 'ai.krisp.krispMac.other', 0],
    ] as const) {
      const contents = join(dir, `${name}.app`, 'Contents');
      const helper = join(contents, 'Frameworks', 'Helper.app', 'Contents', 'MacOS', 'helper');
      mkdirSync(join(helper, '..'), { recursive: true });
      writeFileSync(join(contents, 'Info.plist'), `<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${identifier}</string></dict></plist>`);
      copyFileSync(probe, helper);
      expect(Bun.spawnSync([helper]).exitCode).toBe(expected);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
