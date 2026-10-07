import type { ReactNode } from 'react';
import { useCopy } from '../hooks/useCopy';

interface Props {
  /** text, or a function so large values are only built on click */
  text: string | (() => string);
  children: ReactNode;
  className?: string;
  title?: string;
}

export function CopyButton({ text, children, className = 'ibtn', title }: Props) {
  const [done, copy] = useCopy();
  return (
    <button
      type="button"
      className={`${className}${done ? ' done' : ''}`}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        copy(typeof text === 'function' ? text() : text);
      }}
    >
      {done ? 'Copied ✓' : children}
    </button>
  );
}
