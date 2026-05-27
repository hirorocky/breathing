/** 同じ seed から常に同じ 0..1 の値を返す（配置の再現用） */
export function seededRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 31) * 43758.5453;
  return x - Math.floor(x);
}

/** 配列からランダムに 1 つ選ぶ */
export function pickRandom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}
