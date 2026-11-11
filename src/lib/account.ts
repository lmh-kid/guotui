/**
 * 账号体系工具
 *
 * 用户使用「账号名」（如 admin、test）登录，底层 Supabase Auth 仍走邮箱协议，
 * 内部将账号名映射为固定域名的登录邮箱：admin → admin@guotui.local
 *
 * 兼容：输入若包含 @ 则视为完整邮箱（历史账号仍可登录）。
 */

export const ACCOUNT_EMAIL_DOMAIN = '@guotui.local';

/**
 * 全角字符 → 半角并去除首尾空格。
 * 中文输入法下常见误输入：＠ ａｄｍｉｎ １２３（全角）等，会导致密码校验必然失败，
 * 登录/创建用户前统一归一化（系统账号密码均为半角 ASCII）。
 */
export function normalizeAsciiInput(input: string): string {
  return input
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
    .trim();
}

/** 登录输入（账号名或完整邮箱）→ Supabase 登录邮箱 */
export function accountToEmail(input: string): string {
  const trimmed = normalizeAsciiInput(input).toLowerCase();
  if (trimmed.includes('@')) return trimmed;
  return `${trimmed}${ACCOUNT_EMAIL_DOMAIN}`;
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
