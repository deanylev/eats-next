export const flashCookieNames = {
  adminError: 'admin_error_message',
  adminSuccess: 'admin_success_message',
  rootCreateError: 'root_create_error_message',
  rootCreateSuccess: 'root_create_success_message',
  rootEditError: 'root_edit_error_message',
  rootEditSuccess: 'root_edit_success_message',
  rootDeleteError: 'root_delete_error_message'
} as const;

export type FlashCookieName = (typeof flashCookieNames)[keyof typeof flashCookieNames];
export type FlashCookiePath = '/admin' | '/';

export const decodeFlashMessage = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export const clearFlashCookieClient = (name: FlashCookieName, path: FlashCookiePath): void => {
  document.cookie = `${name}=; Max-Age=0; path=${path}; SameSite=Lax`;
};
