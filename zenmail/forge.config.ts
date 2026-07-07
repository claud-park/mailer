import fs from 'node:fs';
import path from 'node:path';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

// vite.main.config.mts marks these external, but the Forge Vite template ships an asar that
// contains ONLY .vite/ + package.json — externals silently resolve up and out of the asar into
// the project's node_modules during development, then fail (or worse, half-work) in an installed
// app. Copy each external plus its full production-dependency closure into the package.
const RUNTIME_EXTERNALS = ['better-sqlite3', 'keytar', 'googleapis', 'electron-squirrel-startup'];

// Mirrors Node's actual CommonJS resolution: walk up from the REQUIRING package's own
// directory, checking `<ancestor>/node_modules/<name>` at each level (skipping ancestors
// already named `node_modules`, so we don't double it up), same as require() would. A flat
// "always look in the project's top-level node_modules" lookup is wrong whenever npm nests a
// dependency's own dependency locally because a conflicting version is hoisted elsewhere —
// e.g. gaxios requires node-fetch@3, but a different node-fetch@2 is hoisted top-level for some
// other consumer, so npm nests gaxios's own node_modules/node-fetch — and node-fetch@3's own
// dependency (data-uri-to-buffer) is in turn hoisted back to the project's top level. Only a
// real per-package resolution walk finds the right file at each step, matching what happens at
// runtime inside the packaged app.
function resolveModuleDir(fromDir: string, name: string, projectRoot: string): string | null {
  let dir = fromDir;
  for (;;) {
    if (path.basename(dir) !== 'node_modules') {
      const candidate = path.join(dir, 'node_modules', name);
      if (fs.existsSync(candidate)) return candidate;
    }
    if (dir === projectRoot) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null; // filesystem root
    dir = parent;
  }
}

function copyExternalModules(buildPath: string): void {
  const projectRoot = __dirname;
  const projectNodeModules = path.join(projectRoot, 'node_modules');
  const destRoot = path.join(buildPath, 'node_modules');
  // Keyed by resolved source path, not name — the same package name can legitimately resolve
  // to different nested versions in different branches of the tree (see node-fetch above).
  const seen = new Set<string>();
  const copy = (name: string, fromDir: string): void => {
    const src = resolveModuleDir(fromDir, name, projectRoot);
    if (!src || seen.has(src)) return;
    seen.add(src);
    // Preserve the same relative nesting the source tree has, so this package's own
    // node_modules-relative resolution keeps working identically post-copy.
    const rel = path.relative(projectNodeModules, src);
    fs.cpSync(src, path.join(destRoot, rel), { recursive: true, dereference: true });
    const pj = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8'));
    for (const dep of Object.keys(pj.dependencies ?? {})) copy(dep, src);
    for (const dep of Object.keys(pj.optionalDependencies ?? {})) copy(dep, src);
  };
  for (const m of RUNTIME_EXTERNALS) copy(m, projectRoot);
}

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: 'ZenMail',
    appBundleId: 'io.zenmail.app',
  },
  hooks: {
    packageAfterCopy: async (_config, buildPath) => {
      copyExternalModules(buildPath);
    },
  },
  rebuildConfig: {},
  makers: [new MakerZIP({}, ['darwin']), new MakerDMG({}, ['darwin'])],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        {
          entry: 'src/main/index.ts',
          config: 'vite.main.config.mts',
          target: 'main',
        },
        {
          entry: 'src/main/preload.ts',
          config: 'vite.preload.config.mts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mts',
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      // flipping fuses rewrites the binary AFTER packager's ad-hoc signing, which breaks the
      // signature — on arm64 macOS that silently kills every helper process (app hangs with
      // zero windows). This re-signs ad-hoc after the flip. Replace with real osxSign for
      // notarized distribution.
      resetAdHocDarwinSignature: true,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
