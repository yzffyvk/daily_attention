'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useDialogFocus } from './dirty-switch-dialog';

export function StructureReaderDialog({ children, onClose, restoreFocus }: {
  children: ReactNode; onClose: () => void; restoreFocus: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const overflow = document.body.style.overflow;
    const background = Array.from(document.body.children)
      .filter((node): node is HTMLElement => node instanceof HTMLElement && node !== backdropRef.current)
      .map(node => ({ node, inert: node.inert }));
    document.body.style.overflow = 'hidden';
    background.forEach(({ node }) => { node.inert = true; });
    return () => {
      document.body.style.overflow = overflow;
      background.forEach(({ node, inert }) => { node.inert = inert; });
      // The inline reader mounts again on close, after effect cleanup.
      requestAnimationFrame(restoreFocus);
    };
  }, [restoreFocus]);
  useDialogFocus({ dialogRef, onClose });
  return createPortal(<div className="structure-reader-backdrop" ref={backdropRef}>
    <section className="structure-reader-dialog" role="dialog" aria-modal="true" aria-label="知识骨架阅读" ref={dialogRef}>{children}</section>
  </div>, document.body);
}
