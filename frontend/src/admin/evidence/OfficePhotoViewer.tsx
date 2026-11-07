import { useEffect, useRef, type RefObject } from 'react'

import { officeImageUrl, type OfficePhoto } from './api'
import './office-photo-viewer.css'

type Props = {
  identity: string
  onClose: () => void
  photo: OfficePhoto
  taskId: string
  triggerRef: RefObject<HTMLButtonElement | null>
}

/** 以保存的 FIELD／OFFICE 原圖查看並下載照片，包含已刪除照片。 */
export function OfficePhotoViewer({
  identity,
  onClose,
  photo,
  taskId,
  triggerRef,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
    closeRef.current?.focus({ preventScroll: true })
    return () => {
      if (dialog.open) {
        if (typeof dialog.close === 'function') dialog.close()
        else dialog.removeAttribute('open')
      }
    }
  }, [])

  function closeViewer() {
    const dialog = dialogRef.current
    if (dialog?.open) {
      if (typeof dialog.close === 'function') dialog.close()
      else dialog.removeAttribute('open')
    }
    onClose()
    window.setTimeout(() => triggerRef.current?.focus(), 0)
  }

  return (
    <dialog
      aria-labelledby="office-photo-viewer-title"
      aria-modal="true"
      className="office-photo-viewer"
      onCancel={(event) => {
        event.preventDefault()
        closeViewer()
      }}
      ref={dialogRef}
    >
      <header className="office-photo-viewer-header">
        <h2 id="office-photo-viewer-title">大圖檢視｜{identity}</h2>
        <button onClick={closeViewer} ref={closeRef} type="button">
          關閉大圖檢視
        </button>
      </header>
      <p className="office-photo-viewer-help">
        檢視保存版本；下載維持原尺寸。
      </p>
      <div className="office-photo-viewer-grid">
        <section aria-label="現場版大圖" className="office-photo-viewer-panel">
          <h3>現場版</h3>
          <p>
            原尺寸：{photo.variants.field.width} ×{' '}
            {photo.variants.field.height} px
          </p>
          <figure>
            <img
              alt={`現場版原尺寸，${identity}`}
              src={officeImageUrl(
                taskId,
                photo.id,
                'field',
                photo.variants.field.sha256,
              )}
            />
            <figcaption>保存的現場版本</figcaption>
          </figure>
          <a
            className="btn"
            download
            href={officeImageUrl(
              taskId,
              photo.id,
              'field',
              photo.variants.field.sha256,
            )}
          >
            下載現場版原尺寸
          </a>
        </section>
        <section aria-label="內業版大圖" className="office-photo-viewer-panel">
          <h3>內業版</h3>
          <p>
            原尺寸：{photo.variants.office.width} ×{' '}
            {photo.variants.office.height} px
          </p>
          <figure>
            <img
              alt={`內業版原尺寸，${identity}`}
              src={officeImageUrl(
                taskId,
                photo.id,
                'office',
                photo.variants.office.sha256,
              )}
            />
            <figcaption>保存的內業版本</figcaption>
          </figure>
          <a
            className="btn"
            download
            href={officeImageUrl(
              taskId,
              photo.id,
              'office',
              photo.variants.office.sha256,
            )}
          >
            下載內業版原尺寸
          </a>
        </section>
      </div>
    </dialog>
  )
}
