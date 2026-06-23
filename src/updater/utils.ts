/** URL 拼接工具 */
export function newUrlFromBase(pathname: string, baseUrl: string): string {
  const result = new URL(pathname, baseUrl);
  return result.href;
}
