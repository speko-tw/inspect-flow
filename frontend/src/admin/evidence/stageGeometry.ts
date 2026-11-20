/**
 * 照片列高依舞台短邊縮放；共同縮放寬高可避免容器限制壓扁舞台。
 */
export function fitStageSize(
  container: { width: number; height: number },
  aspectRatio: number,
): { width: number; height: number } {
  if (
    !Number.isFinite(container.width) ||
    !Number.isFinite(container.height) ||
    !Number.isFinite(aspectRatio) ||
    container.width <= 0 ||
    container.height <= 0 ||
    aspectRatio <= 0
  ) {
    return { width: 0, height: 0 }
  }

  const width = Math.min(container.width, container.height * aspectRatio)
  return { width, height: width / aspectRatio }
}
