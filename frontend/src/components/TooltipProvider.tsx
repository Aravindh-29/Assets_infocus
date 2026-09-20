import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/** Portal keeps icon tooltips visible outside scrolling tables and collapsed navigation. */
export function TooltipProvider() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; above: boolean } | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    function hide() {
      clearTimeout(timer);
      setTip(null);
    }
    function show(event: Event) {
      hide();
      const target = (event.target as Element)?.closest<HTMLElement>(
        '[data-tooltip], .icon-button[aria-label], button[aria-label]:not([role="combobox"])',
      );
      if (!target || target.getAttribute('aria-expanded') === 'true') return;
      const text = target.dataset.tooltip || target.getAttribute('aria-label');
      if (!text) return;
      timer = setTimeout(
        () => {
          const rect = target.getBoundingClientRect();
          const above = rect.bottom + 50 > window.innerHeight;
          setTip({
            text,
            x: Math.max(120, Math.min(window.innerWidth - 120, rect.left + rect.width / 2)),
            y: above ? rect.top - 8 : rect.bottom + 8,
            above,
          });
        },
        event.type === 'focusin' ? 100 : 450,
      );
    }
    document.addEventListener('pointerover', show);
    document.addEventListener('focusin', show);
    document.addEventListener('pointerout', hide);
    document.addEventListener('focusout', hide);
    document.addEventListener('keydown', hide);
    document.addEventListener('pointerdown', hide);
    window.addEventListener('scroll', hide, true);
    return () => {
      hide();
      document.removeEventListener('pointerover', show);
      document.removeEventListener('focusin', show);
      document.removeEventListener('pointerout', hide);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('keydown', hide);
      document.removeEventListener('pointerdown', hide);
      window.removeEventListener('scroll', hide, true);
    };
  }, []);
  return tip
    ? createPortal(
        <div
          role="tooltip"
          className={`console-tooltip ${tip.above ? 'above' : ''}`}
          style={{ left: tip.x, top: tip.y }}
        >
          {tip.text}
        </div>,
        document.body,
      )
    : null;
}
