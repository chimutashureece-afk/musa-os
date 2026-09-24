// Makes Musa OS feel like a Windows program when it runs inside the desktop app:
// its own title bar (the window buttons are drawn by Windows on the right), native
// cursors and text selection, and Start-menu shortcuts that jump to a page.
import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { desktop } from '../lib/device';
import { useAuth, useSettings } from '../context/AuthContext';
import { MusaMark } from './Logo';

const BAR = 36;

function Title() {
  const settings = useSettings();
  const { profile } = useAuth();
  return <span className="truncate">{profile && settings?.name ? `${settings.name} — Musa OS` : 'Musa OS'}</span>;
}

export const DesktopChrome: React.FC = () => {
  const nav = useNavigate();
  useEffect(() => {
    if (!desktop) return;
    const html = document.documentElement;
    html.classList.add('desktop');
    html.style.setProperty('--tb', `${BAR}px`);
    // title bar colours follow light/dark so the Windows buttons always match
    const sync = () => {
      const dark = html.classList.contains('dark');
      desktop?.setTitleBarColors?.({ color: dark ? '#080c0b' : '#032619', symbolColor: '#ffffff' });
    };
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(html, { attributes: true, attributeFilter: ['class'] });
    desktop.onRoute?.((r) => nav(r));
    // no browser-style dragging of images and links out of the window
    const noDrag = (e: DragEvent) => { if ((e.target as HTMLElement)?.closest?.('img, a')) e.preventDefault(); };
    addEventListener('dragstart', noDrag);
    return () => { mo.disconnect(); removeEventListener('dragstart', noDrag); };
  }, [nav]);

  if (!desktop) return null;
  return (
    <div className="desktop-titlebar fixed inset-x-0 top-0 z-[120] flex select-none items-center gap-2.5 bg-brand-950 pl-3 text-[12px] text-white/85 dark:bg-ink-950 no-print"
      style={{ height: BAR, paddingRight: 150 }}>
      <MusaMark size={18} />
      <Title />
    </div>
  );
};
