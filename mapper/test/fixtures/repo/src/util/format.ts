export const formatMoney = (n: number): string => `$${n.toFixed(2)}`;

export const formatLines = function (lines: number[]): string[] {
  return lines.map(formatMoney);
};

export async function loadRate(): Promise<number> {
  return 0.03;
}

function localHelper() {
  return 1;
}
export { localHelper };

export default function (x: number) {
  return x;
}
