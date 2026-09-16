import OpenCC from 'opencc-js/cn2t';

const convertToTaiwanTraditional = OpenCC.Converter({ from: 'cn', to: 'twp' });

/** Convert Simplified Chinese domain data to Taiwan Traditional Chinese. */
export function toTaiwanTraditional(value: string): string {
  return convertToTaiwanTraditional(value);
}
