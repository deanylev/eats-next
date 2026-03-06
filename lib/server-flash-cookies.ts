import { cookies } from 'next/headers';
import type { FlashCookieName, FlashCookiePath } from '@/lib/flash-cookies';

const FLASH_MAX_AGE_SECONDS = 60;

export const setFlashCookieServer = (name: FlashCookieName, message: string, path: FlashCookiePath): void => {
  cookies().set(name, encodeURIComponent(message), {
    httpOnly: false,
    maxAge: FLASH_MAX_AGE_SECONDS,
    path,
    sameSite: 'lax'
  });
};

export const clearFlashCookieServer = (name: FlashCookieName, path: FlashCookiePath): void => {
  cookies().set(name, '', {
    httpOnly: false,
    maxAge: 0,
    path,
    sameSite: 'lax'
  });
};
