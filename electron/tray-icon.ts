import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { type NativeImage, nativeImage } from 'electron';

import { logWarn } from '@/shared/log';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.join(__dirname, '..');
const TRAY_ASSET_DIR = process.env['VITE_DEV_SERVER_URL']
  ? path.join(APP_ROOT, 'public', 'tray')
  : path.join(APP_ROOT, 'dist', 'tray');
const MACOS_TRAY_ICON_SIZE = 18;
const SCALE_FACTORS = [2, 3] as const;
const iconCache = new Map<string, NativeImage>();

export function createTrayIcon(active: boolean): NativeImage {
  const template = process.platform === 'darwin';
  const iconName = template
    ? 'audio-waveform-template'
    : active
      ? 'audio-waveform-active'
      : 'audio-waveform-inactive';
  const cached = iconCache.get(iconName);
  if (cached) {
    return cached;
  }

  const imagePath = trayAssetPath(iconName);
  let image = nativeImage.createFromPath(imagePath);
  if (image.isEmpty()) {
    throw new Error(`Tray icon asset did not load: ${imagePath}`);
  }
  addScaleRepresentations(image, iconName);
  if (template) {
    image = image.resize({
      width: MACOS_TRAY_ICON_SIZE,
      height: MACOS_TRAY_ICON_SIZE,
      quality: 'best',
    });
  }
  image.setTemplateImage(template);
  iconCache.set(iconName, image);
  return image;
}

function trayAssetPath(iconName: string, scaleFactor?: number): string {
  const suffix = scaleFactor === undefined ? '' : `@${String(scaleFactor)}x`;
  return path.join(TRAY_ASSET_DIR, `${iconName}${suffix}.png`);
}

function addScaleRepresentations(image: NativeImage, iconName: string): void {
  for (const scaleFactor of SCALE_FACTORS) {
    const imagePath = trayAssetPath(iconName, scaleFactor);
    try {
      image.addRepresentation({
        scaleFactor,
        dataURL: pngDataUrl(imagePath),
      });
    } catch (reason) {
      logWarn('Failed to add tray icon scale representation.', {
        imagePath,
        reason,
        scaleFactor,
      });
    }
  }
}

function pngDataUrl(imagePath: string): string {
  const png = fs.readFileSync(imagePath);
  return `data:image/png;base64,${png.toString('base64')}`;
}
