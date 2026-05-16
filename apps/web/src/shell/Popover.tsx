import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';

/**
 * Anchored popover. Positions itself just below the anchor element, closes on
 * outside click and Escape. Reused for dropdown menus (File menu, Borders,
 * future Number Format, etc.).
 */
type Props = {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  className?: string;
  ['data-testid']?: string;
  children: ReactNode;
};

export function Popover({ anchorRef, onClose, className, children, ...rest }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  useLayoutEffect(() => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + 2, left: rect.left });
  }, [anchorRef]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (
        !ref.current?.contains(e.target as Node) &&
        !anchorRef.current?.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose, anchorRef]);

  return (
    <div
      ref={ref}
      className={`menu ${className ?? ''}`}
      style={{ top: pos.top, left: pos.left }}
      role="menu"
      data-testid={rest['data-testid']}
    >
      {children}
    </div>
  );
}
