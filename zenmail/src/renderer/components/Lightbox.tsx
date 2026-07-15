import { useEffect, useRef } from 'react';
import { useMailStore } from '../store/mail';

export function Lightbox() {
  const img = useMailStore((s) => s.lightboxImage);
  const close = useMailStore((s) => s.closeLightbox);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (img) panelRef.current?.focus();
  }, [img]);

  if (!img) return null;

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50" onClick={close}>
      <div
        ref={panelRef}
        tabIndex={-1}
        data-testid="attachment-lightbox"
        className="zen-fade-in max-h-[90vh] max-w-[90vw] overflow-auto rounded-lg border border-bg-border bg-bg-subtle p-2 shadow-2xl outline-none"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close();
          e.stopPropagation();
        }}
      >
        <img src={img.dataUri} alt={img.filename} className="max-h-[80vh] max-w-full object-contain" />
        <div className="mt-1 truncate px-1 text-[11px] text-text-muted">{img.filename}</div>
      </div>
    </div>
  );
}
