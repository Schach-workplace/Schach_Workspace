import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
// Only measured neutral geometry survives a pending read; fetched descendants do not.
export default function PeopleProjection({
  current,
  children,
}: {
  current: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    if (current && ref.current) setHeight(ref.current.getBoundingClientRect().height);
  }, [current, children]);
  return (
    <div
      ref={ref}
      className="people-projection"
      aria-hidden={!current}
      style={{ display: 'flow-root', minHeight: current ? undefined : height }}
    >
      {current ? children : null}
    </div>
  );
}
