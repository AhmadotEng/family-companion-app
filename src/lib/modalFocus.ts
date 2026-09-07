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
  scrollRoot,
}: {
  active: boolean;
  onEscape: () => void;
  escapeDisabled?: boolean;
  scrollRoot?: RefObject<HTMLElement | null>;
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

    // Move focus off the page before making its branch inaccessible. Chromium
    // rejects aria-hidden on an ancestor of the currently focused element.
    const initialTarget = focusableElements(container)[0] ?? container;
    focusWithoutScrolling(initialTarget);

    const hiddenSiblings: Array<{
      element: HTMLElement;
      ariaHidden: string | null;
      inert: boolean;
    }> = [];
    let activeBranch: HTMLElement = container;
    while (activeBranch.parentElement) {
      const parent = activeBranch.parentElement;
      for (const sibling of Array.from(parent.children)) {
        if (sibling === activeBranch || !(sibling instanceof HTMLElement)) continue;
        hiddenSiblings.push({
          element: sibling,
          ariaHidden: sibling.getAttribute('aria-hidden'),
          inert: Boolean(sibling.inert),
        });
        sibling.setAttribute('aria-hidden', 'true');
        sibling.inert = true;
      }
      activeBranch = parent;
      if (parent === document.body) break;
    }

    const scrollContainer = scrollRoot?.current ?? container.closest<HTMLElement>('main');
    const previousBodyOverflow = document.body.style.overflow;
    const previousScrollContainerOverflow = scrollContainer?.style.overflow ?? '';
    document.body.style.overflow = 'hidden';
    if (scrollContainer) scrollContainer.style.overflow = 'hidden';

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
      document.body.style.overflow = previousBodyOverflow;
      if (scrollContainer) scrollContainer.style.overflow = previousScrollContainerOverflow;
      for (const { element, ariaHidden, inert } of hiddenSiblings) {
        if (ariaHidden === null) element.removeAttribute('aria-hidden');
        else element.setAttribute('aria-hidden', ariaHidden);
        element.inert = inert;
      }
      if (previouslyFocused?.isConnected) focusWithoutScrolling(previouslyFocused);
    };
  }, [active, scrollRoot]);

  return containerRef;
}
