// The "add to cart" flourish: a small round copy of the product flies from the button to the bag icon in the header, and the bag nods.
// Uses the browser's own Web Animations API (no library) and does nothing at all for visitors who prefer reduced motion.
export function flyToCart(source: Element | null, imageUrl: string | null): void {
  if (typeof document === 'undefined' || !source) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const target = document.querySelector('[data-cart-target]');
  if (!target) return;

  const from = source.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  if (from.width === 0 || to.width === 0) return;

  const size = 52;
  const dot = document.createElement('div');
  Object.assign(dot.style, {
    position: 'fixed',
    left: `${from.left + from.width / 2 - size / 2}px`,
    top: `${from.top + from.height / 2 - size / 2}px`,
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: '50%',
    zIndex: '95',
    pointerEvents: 'none',
    background: imageUrl ? `center / cover no-repeat url("${imageUrl.replace(/"/g, '%22')}"), #6e1423` : '#6e1423',
    boxShadow: '0 10px 30px rgba(61,36,24,.35)',
    border: '2px solid #fbf3e6',
  });
  document.body.append(dot);

  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  const flight = dot.animate(
    [
      { transform: 'translate(0, 0) scale(1)', opacity: 1 },
      { transform: `translate(${dx * 0.55}px, ${dy * 0.55 - 70}px) scale(.7)`, opacity: 1, offset: 0.55 },
      { transform: `translate(${dx}px, ${dy}px) scale(.2)`, opacity: 0.35 },
    ],
    { duration: 720, easing: 'cubic-bezier(.45,.05,.25,1)' },
  );
  flight.onfinish = () => {
    dot.remove();
    target.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.28)' }, { transform: 'scale(1)' }], { duration: 380, easing: 'ease-out' });
  };
  flight.oncancel = () => dot.remove();
}
