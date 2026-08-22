// useScrollWindow — measure an overflow container (scrollTop + viewport height)
// so fixed-height lists can virtualize with `visibleWindow` (app/lib/virtual-window.ts).
// Generic sibling of WorkQueue's internal useQueueScroller.

import { useEffect, useRef, useState } from "react";

const FALLBACK_VIEWPORT_H = 800;

export function useScrollWindow<T extends HTMLElement = HTMLDivElement>() {
  const scrollerRef = useRef<T>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(FALLBACK_VIEWPORT_H);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let frame = 0;
    const readScroll = () => {
      frame = 0;
      setScrollTop(el.scrollTop);
    };
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(readScroll);
    };
    const onResize = () => {
      setViewportH(el.clientHeight || FALLBACK_VIEWPORT_H);
    };
    onResize();
    setScrollTop(el.scrollTop);
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onResize) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
      ro?.disconnect();
    };
  }, []);

  return { scrollerRef, scrollTop, viewportH };
}
