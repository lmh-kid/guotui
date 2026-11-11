/**
 * 账号体系工具
 *
 * 用户使用「账号名」（如 admin、test）登录，底层 Supabase Auth 仍走邮箱协议，
 * 内部将账号名映射为固定域名的登录邮箱：admin → admin@guotui.local
 *
 * 兼容：输入若包含 @ 则视为完整邮箱（历史账号仍可登录）。
 */

export const ACCOUNT_EMAIL_DOMAIN = '@guotui.local';

/** 登录输入（账号名或完整邮箱）→ Supabase 登录邮箱 */
export function accountToEmail(input: string): string {
  const trimmed = input.trim();
  if (trimmed.includes('@')) return trimmed;
  return `${trimmed.toLowerCase()}${ACCOUNT_EMAIL_DOMAIN}`;
}

/** Supabase 邮箱 → 展示账号名（内部域名去掉后缀，历史邮箱原样展示） */
export function displayAccountName(email?: string | null): string {
  if (!email) return '';
  if (email.endsWith(ACCOUNT_EMAIL_DOMAIN)) {
    return email.slice(0, -ACCOUNT_EMAIL_DOMAIN.length);
  }
  return email;
}

/** 校验账号名格式：字母开头，仅字母/数字/._-，2-32 位 */
export function isValidAccountName(input: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9._-]{1,31}$/.test(input.trim());
}
