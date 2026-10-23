/**
 * 拖拽文本是否本身就是网址。
 *
 * 判断与线上原版保持一致：只有绝对 http(s)/ftp 地址算网址，普通词句一律走搜索；
 * 超过 `DIRECT_URL_MAX_LEN` 的单个词不再跑正则（避免对超长文本做无意义的匹配）。
 */

export const DIRECT_URL_MAX_LEN = 2048;

const URL_PATTERN =
  /(ftp|http|https):\/\/(\w+:{0,1}\w*@)?(\S+)(:[0-9]+)?(\/|\/([\w#!:.?+=&%@!-/]))?/i;

/** @param text 任意文本 */
export function looksLikeUrl(text: string): boolean {
  return URL_PATTERN.test(text);
}

/** 中文标点不可能出现在地址里：第一次出现就截断（`https://a。这是说明` → `https://a`）。 */
const CJK_PUNCT = /[。、，．・…？！；：『』「」《》（）【】\u3000]/u;

/** 地址结尾不可能是这些符号（句尾的 `。，;!?` 和全角引号括号）；半角 `)]}` 不在这里剥，
 * Wikipedia 的 `..._(film)` 就是右括号结尾，见 `balanceTrailingParen`。 */
const TRAILING_PUNCT = /[。.，,;；:：!！?？'"'""…、〉》」』〕）]+$/u;

/** 括号配平：右括号比左括号多时，多出来的只能是句尾混进来的，剥掉一个。
 *
 * `（见https://a)` → `https://a`；`..._(film)` 配平，保留。 */
function balanceTrailingParen(url: string): string {
  if (!url.endsWith(')')) return url;
  let depth = 0;
  for (const char of url) {
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
  }
  return depth < 0 ? url.slice(0, -1) : url;
}

/**
 * 从一段无空格的文字里切出地址：从协议头开始，到中文标点结束。
 *
 * `见https://example.com/a好` 这种粘在一起的也能切出中间的地址；
 * 纯 IDN（`https://例子.测试`，半角点）不受影响，只有全角标点会截断。
 */
function extractUrlCandidate(keyword: string): string {
  const start = keyword.search(/(ftp|https?):\/\//i);
  const fromStart = start >= 0 ? keyword.slice(start) : keyword;
  const cut = fromStart.search(CJK_PUNCT);
  const candidate = cut >= 0 ? fromStart.slice(0, cut) : fromStart;
  return balanceTrailingParen(candidate.replace(TRAILING_PUNCT, ''));
}

/**
 * 把拖拽的文本转成“直接打开”的地址。
 *
 * @returns 可直接打开的地址；`''` 表示应当走搜索
 */
export function asDirectUrl(text: string | null | undefined): string {
  const keyword = typeof text === 'string' ? text.trim() : '';
  if (keyword === '' || keyword.length > DIRECT_URL_MAX_LEN || /\s/.test(keyword)) return '';
  const stripped = extractUrlCandidate(keyword);
  if (stripped === '') return '';
  return looksLikeUrl(stripped) ? stripped : '';
}
