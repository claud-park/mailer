import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { rebuild } from '@electron/rebuild';

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

// copyExternalModules copies better-sqlite3's native binding straight from the project's own
// node_modules, which npm/node-gyp builds against the LOCAL Node.js ABI — not Electron's. (The
// project's `pretest` script even re-triggers this via `npm rebuild better-sqlite3` for plain-Node
// test runs.) A packaged app shipping that binary throws ERR_DLOPEN_FAILED (NODE_MODULE_VERSION
// mismatch) the moment cache.ts opens the database, before the main window is ever created — the
// dock icon appears but no window shows, with no crash dialog. Rebuild it here, against the
// Electron version/arch actually being packaged, every time.
async function rebuildNativeModules(buildPath: string, electronVersion: string, arch: string): Promise<void> {
  await rebuild({
    buildPath,
    electronVersion,
    arch,
    onlyModules: ['better-sqlite3'],
    force: true,
  });
}

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: 'ZenMail',
    appBundleId: 'io.zenmail.app',
    icon: './assets/icon', // extension omitted — packager appends .icns (mac) / .ico (win) per platform
  },
  hooks: {
    packageAfterCopy: async (_config, buildPath) => {
      copyExternalModules(buildPath);
    },
    // A separate, later hook stage (not packageAfterCopy) on purpose: FusesPlugin's flipFuses
    // also runs on packageAfterCopy, and Forge runs all packageAfterCopy hooks concurrently — the
    // rebuild below is slow (network header fetch + node-gyp compile) and raced/corrupted the
    // packager's own temp Electron.app extraction when it lived there. packageAfterPrune fires
    // strictly after every packageAfterCopy hook is done, so buildPath is stable by the time we
    // get here.
    packageAfterPrune: async (_config, buildPath, electronVersion, _platform, arch) => {
      await rebuildNativeModules(buildPath, electronVersion, arch);
    },
    // FusesPlugin's resetAdHocDarwinSignature (below) re-signs during packageAfterCopy — the
    // SAME lifecycle stage as this hook — which runs before @electron/packager's own
    // updatePlistFiles() finalizes Info.plist (bundle id/name, ElectronAsarIntegrity hash).
    // That seals a stale Info.plist: `codesign -d` then shows "Info.plist=not bound" and macOS
    // silently kills the app on launch on Apple Silicon (no dialog, no crash log). Disabled
    // there; re-signed here instead, once packaging (and Info.plist) is truly finalized.
    postPackage: async (_config, { platform, outputPaths }) => {
      if (platform !== 'darwin') return;
      for (const outputPath of outputPaths) {
        const appName = fs.readdirSync(outputPath).find((f) => f.endsWith('.app'));
        if (!appName) continue;
        execFileSync('codesign', [
          '--sign',
          '-',
          '--force',
          '--preserve-metadata=entitlements,requirements,flags,runtime',
          '--deep',
          path.join(outputPath, appName),
        ]);
      }
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
      // Do NOT let this auto-resign (its default is true here on arm64 without osxSign) — it
      // runs during packageAfterCopy, before packager writes the final Info.plist, so the
      // resulting signature seals a stale plist. See the postPackage hook above, which
      // re-signs ad-hoc at the correct point instead. Replace both with real osxSign for
      // notarized distribution.
      resetAdHocDarwinSignature: false,
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
