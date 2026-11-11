/**
 * The full-size volumes a right discounts, as words: `30 или 50`, `30, 50 или 100`, `50`. The list
 * is the server's (setting `pricing.fullSizeVolumesMl`), never a constant here.
 */
export function volumesText(ml: readonly number[], or: string): string {
  if (ml.length <= 1) return ml.map(String).join('');
  return `${ml.slice(0, -1).join(', ')} ${or} ${ml[ml.length - 1]}`;
}
