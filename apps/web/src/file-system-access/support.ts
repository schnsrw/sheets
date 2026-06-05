/**
 * Feature detection for the File System Access API. Chromium-only at
 * the time of writing (Chrome / Edge / Brave / Opera on desktop). All
 * call sites must guard with `isFsaSupported()` and fall back to the
 * download-blob path when false — Firefox / Safari users still get
 * Save, they just get the existing browser download UX.
 */

export function isFsaSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}
