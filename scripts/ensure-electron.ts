#!/usr/bin/env bun

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type ElectronPlatform = NodeJS.Platform | 'mas';

interface ElectronPackageJson {
  version: string;
}

const LOG_PREFIX = '[relay]';

interface InstallerContext {
  electronDir: string;
  electronPackage: ElectronPackageJson;
  pathFile: string;
}

let electronReadinessFailureLogged = false;

function createInstallerContext(): InstallerContext {
  const electronPackagePath = fileURLToPath(import.meta.resolve('electron/package.json'));
  const electronDir = path.dirname(electronPackagePath);
  return {
    electronDir,
    electronPackage: readElectronPackageJson(electronPackagePath),
    pathFile: path.join(electronDir, 'path.txt'),
  };
}

function readElectronPackageJson(packagePath: string): ElectronPackageJson {
  const parsed = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as Partial<ElectronPackageJson>;
  if (typeof parsed.version !== 'string') {
    throw new Error('Electron package version is missing.');
  }
  return { version: parsed.version };
}

function normalizePlatform(value: string | undefined): ElectronPlatform {
  const platform = value ?? process.platform;
  switch (platform) {
    case 'aix':
    case 'android':
    case 'darwin':
    case 'freebsd':
    case 'haiku':
    case 'linux':
    case 'mas':
    case 'openbsd':
    case 'sunos':
    case 'win32':
    case 'cygwin':
    case 'netbsd':
      return platform;
    default:
      throw new Error(`Electron builds are not available on ${platform}`);
  }
}

function platformPath(platform: ElectronPlatform = process.platform): string {
  switch (platform) {
    case 'mas':
    case 'darwin':
      return 'Electron.app/Contents/MacOS/Electron';
    case 'freebsd':
    case 'openbsd':
    case 'linux':
      return 'electron';
    case 'win32':
      return 'electron.exe';
    default:
      throw new Error(`Electron builds are not available on ${platform}`);
  }
}

async function isElectronReady(): Promise<boolean> {
  try {
    const electronModule = await import('electron');
    const electronPath = electronModule.default;
    return typeof electronPath === 'string' && fs.existsSync(electronPath);
  } catch (reason) {
    if (!electronReadinessFailureLogged) {
      electronReadinessFailureLogged = true;
      console.warn(
        LOG_PREFIX,
        'Electron readiness check failed; trying installer fallback.',
        reason
      );
    }
    return false;
  }
}

function runStandardInstaller(context: InstallerContext): void {
  const env = { ...process.env };
  delete env['ELECTRON_SKIP_BINARY_DOWNLOAD'];
  try {
    execFileSync(process.execPath, [path.join(context.electronDir, 'install.js')], {
      env,
      stdio: 'inherit',
    });
  } catch (reason) {
    console.warn(
      LOG_PREFIX,
      'Standard Electron installer failed; trying explicit installer.',
      reason
    );
    // Fall through to the explicit installer below.
  }
}

function electronCacheDir(platform: ElectronPlatform): string {
  const configuredCache = process.env['electron_config_cache'];
  if (configuredCache !== undefined && configuredCache !== '') {
    return configuredCache;
  }
  if (platform === 'darwin' || platform === 'mas') {
    return path.join(os.homedir(), 'Library', 'Caches', 'electron');
  }
  if (platform === 'win32') {
    return path.join(
      process.env['LOCALAPPDATA'] ?? path.join(os.homedir(), 'AppData', 'Local'),
      'electron',
      'Cache'
    );
  }
  return path.join(process.env['XDG_CACHE_HOME'] ?? path.join(os.homedir(), '.cache'), 'electron');
}

function downloadZip(zipPath: string, artifactName: string, version: string): void {
  if (fs.existsSync(zipPath)) {
    return;
  }
  fs.mkdirSync(path.dirname(zipPath), { recursive: true });
  const url = `https://github.com/electron/electron/releases/download/v${version}/${artifactName}`;
  execFileSync('curl', ['--fail', '--location', '--output', zipPath, url], {
    stdio: 'inherit',
  });
}

function extractZip(zipPath: string, distPath: string, platform: ElectronPlatform): void {
  fs.rmSync(distPath, { force: true, recursive: true });
  fs.mkdirSync(distPath, { recursive: true });

  if (platform === 'darwin' || platform === 'mas') {
    execFileSync('ditto', ['-x', '-k', zipPath, distPath], {
      stdio: 'inherit',
    });
    return;
  }

  if (platform === 'win32') {
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Expand-Archive -LiteralPath ${JSON.stringify(zipPath)} -DestinationPath ${JSON.stringify(distPath)} -Force`,
      ],
      { stdio: 'inherit' }
    );
    return;
  }

  execFileSync('unzip', ['-o', zipPath, '-d', distPath], {
    stdio: 'inherit',
  });
}

function runExplicitInstaller(context: InstallerContext): void {
  const platform = normalizePlatform(process.env['npm_config_platform']);
  const arch = process.env['npm_config_arch'] ?? process.arch;
  const artifactName = `electron-v${context.electronPackage.version}-${platform}-${arch}.zip`;
  const zipPath = path.join(electronCacheDir(platform), artifactName);
  const distPath = path.join(context.electronDir, 'dist');

  downloadZip(zipPath, artifactName, context.electronPackage.version);
  extractZip(zipPath, distPath, platform);

  const sourceTypesPath = path.join(distPath, 'electron.d.ts');
  if (fs.existsSync(sourceTypesPath)) {
    fs.renameSync(sourceTypesPath, path.join(context.electronDir, 'electron.d.ts'));
  }

  fs.writeFileSync(context.pathFile, platformPath(platform));
}

async function main(): Promise<void> {
  const context = createInstallerContext();
  if (!(await isElectronReady())) {
    runStandardInstaller(context);
  }

  if (!(await isElectronReady())) {
    runExplicitInstaller(context);
  }

  if (!(await isElectronReady())) {
    throw new Error('Electron binary is still missing after install.');
  }
}

await main().catch((reason: unknown) => {
  console.error(LOG_PREFIX, 'Failed to ensure Electron binary.', reason);
  process.exitCode = 1;
});
