import { useEffect, useRef } from 'react';

// Fades sections in as they scroll into view. Content stays visible when the
// browser has no IntersectionObserver or the visitor prefers reduced motion.
export default function useReveal() {
  const ref = useRef(null);
  useEffect(() => {
    const root = ref.current;
    if (!root || typeof IntersectionObserver !== 'function'
      || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    const items = [...root.querySelectorAll('[data-reveal]')];
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-revealed');
        observer.unobserve(entry.target);
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    root.classList.add('reveal-ready');
    items.forEach(item => observer.observe(item));
    return () => { observer.disconnect(); root.classList.remove('reveal-ready'); };
  }, []);
  return ref;
}
