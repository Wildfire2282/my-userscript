/**
 * 拖拽文本是否本身就是网址。
 *
 * 判断与线上原版保持一致：只有绝对 http(s)/ftp 地址算网址，普通词句一律走搜索；
 * 超过 `DIRECT_URL_MAX_LEN` 的单个词不再跑正则（避免对超长文本做无意义的匹配）。
 */

export const DIRECT_URL_MAX_LEN = 2048;

const URL_PATTERN =
  /(ftp|http|https):\/\/(\w+:{0,1}\w*@)?(\S+)(:[0-9]+)?(\/|\/([\w#!:.?+=&%@!-/]))?/;

/** @param text 任意文本 */
export function looksLikeUrl(text: string): boolean {
  return URL_PATTERN.test(text);
}

/**
 * 把拖拽的文本转成“直接打开”的地址。
 *
 * @returns 可直接打开的地址；`''` 表示应当走搜索
 */
export function asDirectUrl(text: string | null | undefined): string {
  const keyword = typeof text === 'string' ? text.trim() : '';
  if (keyword === '' || keyword.length > DIRECT_URL_MAX_LEN || /\s/.test(keyword)) return '';
  return looksLikeUrl(keyword) ? keyword : '';
}
