import React from 'react';
import { SchoolSettings } from '../types';
import { cx } from '../lib/utils';

/** The school's own badge if uploaded, otherwise its initials in a ring. */
export const SchoolCrest: React.FC<{ settings?: SchoolSettings; size?: number; className?: string; ring?: boolean }> = ({ settings, size = 64, className, ring = true }) => {
  if (settings?.logo) {
    return <img src={settings.logo} alt={`${settings.name} logo`} width={size} height={size} draggable={false}
      className={cx('shrink-0 select-none object-contain', className)} style={{ width: size, height: size }} />;
  }
  const initials = (settings?.name ?? 'S').split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).map((w) => w[0]!.toUpperCase()).slice(0, 2).join('');
  return (
    <div className={cx('flex shrink-0 items-center justify-center rounded-full font-display font-bold tracking-tight', ring && 'border-2 border-current', className)}
      style={{ width: size, height: size, fontSize: size * 0.36 }}>{initials}</div>
  );
};

/** Read an image file and shrink it to a small square-fitting PNG/WebP data URL for storing with the school. */
export async function logoFromFile(file: File, max = 320): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file (PNG, JPG or SVG).');
  if (file.size > 10 * 1024 * 1024) throw new Error('That image is over 10 MB — choose a smaller one.');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not open that image.')); i.src = url; });
    const k = Math.min(1, max / Math.max(img.naturalWidth || max, img.naturalHeight || max));
    const w = Math.max(1, Math.round((img.naturalWidth || max) * k)), h = Math.max(1, Math.round((img.naturalHeight || max) * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d')!.drawImage(img, 0, 0, w, h);
    let out = c.toDataURL('image/webp', 0.9);
    if (!out.startsWith('data:image/webp')) out = c.toDataURL('image/png');
    if (out.length > 200_000) out = c.toDataURL('image/jpeg', 0.85);
    return out;
  } finally { URL.revokeObjectURL(url); }
}
