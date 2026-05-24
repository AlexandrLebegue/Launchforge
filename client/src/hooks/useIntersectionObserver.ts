import { useEffect } from 'react';

/**
 * Attaches an IntersectionObserver to every `.reveal` element in the DOM.
 * When an element enters the viewport, it receives the `.visible` class,
 * which triggers the CSS transition defined in index.css.
 *
 * Call this hook once per page — it scans the entire document.
 */
export function useIntersectionObserver(threshold = 0.12) {
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target); // reveal once only
          }
        });
      },
      { threshold }
    );

    // Observe all .reveal elements that haven't been revealed yet
    const targets = document.querySelectorAll<Element>('.reveal:not(.visible)');
    targets.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, [threshold]);
}

/**
 * Alternative: returns a ref for a single element.
 * Adds .visible class when the element scrolls into view.
 */
export function useRevealRef(threshold = 0.12) {
  const ref = { current: null as HTMLElement | null };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add('visible');
          observer.unobserve(el);
        }
      },
      { threshold }
    );

    observer.observe(el);
    return () => observer.disconnect();
  });

  return ref;
}
