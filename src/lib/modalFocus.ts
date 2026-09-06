import { useEffect, useRef, type RefObject } from 'react';

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(focusableSelector))
    .filter(element => element.getAttribute('aria-hidden') !== 'true' && !element.hidden);
}

function focusWithoutScrolling(element: HTMLElement) {
  try {
    element.focus({ preventScroll: true });
  } catch {
    element.focus();
  }
}

/**
 * Moves focus into an active modal, keeps keyboard focus inside it, closes on
 * Escape when permitted, and restores the previously focused control.
 */
export function useModalFocusTrap<T extends HTMLElement>({
  active,
  onEscape,
  escapeDisabled = false,
}: {
  active: boolean;
  onEscape: () => void;
  escapeDisabled?: boolean;
}): RefObject<T | null> {
  const containerRef = useRef<T>(null);
  const onEscapeRef = useRef(onEscape);
  const escapeDisabledRef = useRef(escapeDisabled);
  onEscapeRef.current = onEscape;
  escapeDisabledRef.current = escapeDisabled;

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    const initialTarget = focusableElements(container)[0] ?? container;
    focusWithoutScrolling(initialTarget);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!escapeDisabledRef.current) {
          event.preventDefault();
          event.stopPropagation();
          onEscapeRef.current();
        }
        return;
      }

      if (event.key !== 'Tab') return;
      const focusable = focusableElements(container);
      if (focusable.length === 0) {
        event.preventDefault();
        focusWithoutScrolling(container);
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const focused = document.activeElement;
      if (event.shiftKey && (focused === first || !container.contains(focused))) {
        event.preventDefault();
        focusWithoutScrolling(last);
      } else if (!event.shiftKey && (focused === last || !container.contains(focused))) {
        event.preventDefault();
        focusWithoutScrolling(first);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocused?.isConnected) focusWithoutScrolling(previouslyFocused);
    };
  }, [active]);

  return containerRef;
}
