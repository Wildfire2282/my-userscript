/**
 * 策略顺序。
 *
 * 上一次成功的策略下次优先：YouTube 改版时往往只有一种结构还能用，记住它可以让
 * 后续每次复制都少走几条注定失败的路径。记住的下标只在合法范围内生效，
 * 存储被写坏时退回默认顺序。
 */
export function prioritize(count: number, savedIndex: number | undefined): number[] {
  const order = Array.from({ length: count }, (_, index) => index);
  if (
    savedIndex === undefined ||
    !Number.isInteger(savedIndex) ||
    savedIndex <= 0 ||
    savedIndex >= count
  ) {
    return order;
  }
  return [savedIndex, ...order.filter((index) => index !== savedIndex)];
}
