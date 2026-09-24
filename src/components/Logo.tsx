import React from 'react';
import markUrl from '../assets/musa-mark.png';
import { cx } from '../lib/utils';

export const PRODUCT_NAME = 'Musa OS';

/** The Musa OS "M + mortarboard" mark. */
export const MusaMark: React.FC<{ size?: number; className?: string }> = ({ size = 36, className }) => (
  <img src={markUrl} width={size} height={size} alt="Musa OS" className={cx('shrink-0 select-none object-contain', className)} draggable={false} />
);

/** Mark + wordmark. `tone="light"` is for dark backgrounds (sidebar). */
export const MusaLogo: React.FC<{ size?: number; tone?: 'auto' | 'light'; className?: string; textClass?: string }> = ({ size = 34, tone = 'auto', className, textClass }) => (
  <span className={cx('inline-flex items-center gap-2.5', className)}>
    <MusaMark size={size} />
    <span className={cx('font-display font-bold leading-none tracking-[-0.02em]', textClass ?? 'text-[1.2rem]')}>
      <span className={tone === 'light' ? 'text-white' : 'text-brand-900 dark:text-white'}>Musa</span>
      <span className={tone === 'light' ? 'text-brand-400' : 'text-brand-500 dark:text-brand-400'}>OS</span>
    </span>
  </span>
);
