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

function copyExternalModules(buildPath: string): void {
  const projectNodeModules = path.join(__dirname, 'node_modules');
  const seen = new Set<string>();
  const copy = (name: string): void => {
    if (seen.has(name)) return;
    seen.add(name);
    const src = path.join(projectNodeModules, name);
    if (!fs.existsSync(src)) return;
    fs.cpSync(src, path.join(buildPath, 'node_modules', name), { recursive: true, dereference: true });
    const pj = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8'));
    for (const dep of Object.keys(pj.dependencies ?? {})) copy(dep);
    for (const dep of Object.keys(pj.optionalDependencies ?? {})) copy(dep);
  };
  for (const m of RUNTIME_EXTERNALS) copy(m);
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
