import { isTauri } from '@tauri-apps/api/core';

export async function readNativeClipboardImage(): Promise<File | undefined> {
  if (!isTauri()) return undefined;
  try {
    const { readImage } = await import('@tauri-apps/plugin-clipboard-manager');
    const image = await readImage();
    try {
      const [{ width, height }, rgba] = await Promise.all([image.size(), image.rgba()]);
      if (
        !width
        || !height
        || width > 8192
        || height > 8192
        || width * height > 16_000_000
        || rgba.length !== width * height * 4
      ) return undefined;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) return undefined;
      context.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      return blob ? new File([blob], 'pasted-image.png', { type: 'image/png' }) : undefined;
    } finally {
      await image.close();
    }
  } catch {
    return undefined;
  }
}
