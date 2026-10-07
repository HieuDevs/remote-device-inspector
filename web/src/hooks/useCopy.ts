import { useEffect, useRef, useState } from 'react';
import { copyToClipboard } from '../lib/clipboard';

/** Copy with a short "Copied ✓" confirmation on the button. */
export function useCopy(): [done: boolean, copy: (text: string) => void] {
  const [done, setDone] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = (text: string) => {
    void copyToClipboard(text).then(() => {
      setDone(true);
      clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setDone(false), 1400);
    });
  };
  return [done, copy];
}
