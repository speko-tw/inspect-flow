import { describe, expect, it } from 'vitest'

import { parseCaptureTime, readCaptureTime } from './captureTime'
import { jpegWithExif } from './testFixtures'

const toBuffer = (bytes: Uint8Array<ArrayBuffer>) =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)

describe('parseCaptureTime', () => {
  it.each([true, false])('讀出 EXIF 拍攝時間（little=%s）', (little) => {
    const bytes = jpegWithExif({ little, date: '2026:10:31 10:24:05' })
    expect(parseCaptureTime(toBuffer(bytes))).toBe(
      new Date(2026, 9, 31, 10, 24, 5).toISOString(),
    )
  })

  it('有時區偏移時以偏移為準', () => {
    const bytes = jpegWithExif({
      date: '2026:10:31 10:24:00',
      offset: '+08:00',
    })
    expect(parseCaptureTime(toBuffer(bytes))).toBe('2026-10-31T02:24:00.000Z')
    const west = jpegWithExif({
      date: '2026:10:31 10:24:00',
      offset: '-05:30',
    })
    expect(parseCaptureTime(toBuffer(west))).toBe('2026-10-31T15:54:00.000Z')
  })

  it('讀不到或格式不對就回 null', () => {
    expect(parseCaptureTime(toBuffer(jpegWithExif({})))).toBeNull()
    expect(
      parseCaptureTime(toBuffer(jpegWithExif({ date: '昨天下午' }))),
    ).toBeNull()
    expect(parseCaptureTime(new Uint8Array([1, 2, 3, 4]).buffer)).toBeNull()
    expect(parseCaptureTime(new ArrayBuffer(0))).toBeNull()
  })
})

describe('readCaptureTime', () => {
  it('從檔案讀出拍攝時間，失敗時回 null 不拋錯', async () => {
    const bytes = jpegWithExif({
      date: '2026:10:31 10:24:00',
      offset: '+08:00',
    })
    const file = new File([bytes], 'a.jpg', { type: 'image/jpeg' })
    await expect(readCaptureTime(file)).resolves.toBe(
      '2026-10-31T02:24:00.000Z',
    )
    const broken = {
      slice: () => {
        throw new Error('x')
      },
    }
    await expect(
      readCaptureTime(broken as unknown as Blob),
    ).resolves.toBeNull()
  })
})
