import { initLocale } from '@renderer/lib/i18n';
import * as runtime from '@renderer/paraglide/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@renderer/paraglide/runtime', () => ({
  getLocale: vi.fn(),
  setLocale: vi.fn(),
}));

describe('renderer locale initialization', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('defaults a fresh installation to Traditional Chinese', () => {
    expect(initLocale()).toBe('zh-TW');
    expect(runtime.setLocale).toHaveBeenCalledWith('zh-TW', { reload: false });
  });

  it.each(['zh-TW', 'zh-CN', 'en'] as const)('preserves stored locale %s', (locale) => {
    localStorage.setItem('carbonink.locale', locale);

    expect(initLocale()).toBe(locale);
    expect(runtime.setLocale).toHaveBeenCalledWith(locale, { reload: false });
  });
});
