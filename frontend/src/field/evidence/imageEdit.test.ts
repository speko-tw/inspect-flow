import { createHash, randomBytes } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  JPEG_QUALITY,
  MAX_EDGE,
  applyBrightness,
  brightnessFactor,
  newIdempotencyKey,
  normalizeRotation,
  outputSize,
  sha256Fallback,
  sha256Hex,
} from './imageEdit'

describe('亮度（FEV-R02：倍率 1+v/200）', () => {
  it('−100～+100 對應 0.5～1.5', () => {
    expect(brightnessFactor(-100)).toBe(0.5)
    expect(brightnessFactor(0)).toBe(1)
    expect(brightnessFactor(100)).toBe(1.5)
    expect(brightnessFactor(50)).toBe(1.25)
  })

  it('RGB 乘倍率後正數四捨五入並限制在 0～255，不動 alpha', () => {
    const data = new Uint8ClampedArray([255, 101, 0, 77, 200, 3, 255, 255])
    applyBrightness(data, 100)
    // 255×1.5 與 200×1.5 超界取 255；101×1.5=151.5 進位成 152。
    expect([...data]).toEqual([255, 152, 0, 77, 255, 5, 255, 255])
    const dark = new Uint8ClampedArray([255, 101, 0, 9])
    applyBrightness(dark, -100)
    // 255×0.5=127.5 進位 128；101×0.5=50.5 進位 51；端點不會全黑。
    expect([...dark]).toEqual([128, 51, 0, 9])
  })

  it('亮度 0 不改動像素', () => {
    const data = new Uint8ClampedArray([1, 2, 3, 4])
    applyBrightness(data, 0)
    expect([...data]).toEqual([1, 2, 3, 4])
  })
})

describe('旋轉與壓縮尺寸（FEV-R02、D2）', () => {
  it('長邊上限 2560，品質 0.85', () => {
    expect(MAX_EDGE).toBe(2560)
    expect(JPEG_QUALITY).toBe(0.85)
  })

  it('旋轉 90 度後寬高互換，再縮到長邊上限', () => {
    expect(outputSize(4000, 3000, 0, MAX_EDGE)).toMatchObject({
      width: 2560,
      height: 1920,
      drawWidth: 2560,
      drawHeight: 1920,
    })
    expect(outputSize(4000, 3000, 90, MAX_EDGE)).toMatchObject({
      width: 1920,
      height: 2560,
      drawWidth: 2560,
      drawHeight: 1920,
    })
  })

  it('小圖不放大', () => {
    expect(outputSize(800, 600, 270, MAX_EDGE)).toMatchObject({
      width: 600,
      height: 800,
    })
  })

  it('旋轉角度正規化成 0／90／180／270', () => {
    expect(normalizeRotation(360)).toBe(0)
    expect(normalizeRotation(450)).toBe(90)
    expect(normalizeRotation(-90)).toBe(270)
  })
})

describe('完整性雜湊與冪等鍵', () => {
  it('純 JS SHA-256 與標準向量及 node 結果一致', () => {
    const encode = (text: string) => new TextEncoder().encode(text)
    expect(sha256Fallback(encode(''))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
    expect(sha256Fallback(encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    for (const size of [1, 55, 56, 63, 64, 65, 1000, 70001]) {
      const bytes = new Uint8Array(randomBytes(size))
      expect(sha256Fallback(bytes)).toBe(
        createHash('sha256').update(bytes).digest('hex'),
      )
    }
  })

  it('Blob 的 SHA-256 為 64 位小寫十六進位', async () => {
    const hash = await sha256Hex(new Blob(['abc']))
    expect(hash).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('冪等鍵是 UUID v4 且每次不同', () => {
    const first = newIdempotencyKey()
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(newIdempotencyKey()).not.toBe(first)
  })
})
