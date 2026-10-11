import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
// Only a finite numeric measurement survives a current-source check; children unmount.
export default function IntelligenceGeometry({
  visible,
  children,
}: {
  visible: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    if (!visible || !ref.current) return;
    const measure = () => {
      const h = ref.current?.getBoundingClientRect().height ?? 0;
      if (Number.isFinite(h)) setHeight(Math.min(50000, Math.max(0, h)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [visible, children]);
  return (
    <div ref={ref} style={visible ? undefined : { height }} aria-hidden={!visible}>
      {visible ? children : null}
    </div>
  );
}
