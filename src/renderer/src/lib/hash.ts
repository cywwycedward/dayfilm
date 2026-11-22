/** 字符串哈希与确定性伪随机。剧照与 mock 数据都依赖这里，必须无副作用。 */

/** FNV-1a 32 位哈希：同一字符串永远得到同一个无符号整数。 */
export function hashString(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** 从哈希派生第 salt 个 [0,1) 数值，用来决定剧照的每个细节。 */
export function unitAt(seed: number, salt: number): number {
  let x = (seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0
  x = Math.imul(x ^ (x >>> 15), 0x85ebca6b) >>> 0
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0
  x = (x ^ (x >>> 16)) >>> 0
  return x / 4_294_967_296
}

/** mulberry32：给定种子产生固定的伪随机序列，用于生成整天 mock 数据。 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}
