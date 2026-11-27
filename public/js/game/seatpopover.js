// Keep one searchable panel in the trigger's tab order, above the scrolling
// sidebar. Its viewport position never participates in roster/table layout.
export function seatPopover(panel, close) {
  panel.setAttribute('popover', 'manual');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Choose a faction');
  let events;
  return {
    open(button) {
      events = new AbortController();
      const { signal } = events;
      button.after(panel);
      panel.hidden = false;
      panel.showPopover?.();
      const rail = button.closest('.op-rail');
      const position = () => {
        const a = button.getBoundingClientRect(),
          railBox = rail.getBoundingClientRect(),
          clip = button.closest('.uc-content').getBoundingClientRect();
        if (!a.height || a.bottom <= clip.top || a.top >= clip.bottom) return close();
        const pad = 8,
          gap = 4,
          width = Math.min(420, railBox.width - pad * 2, innerWidth - pad * 2),
          left = Math.max(pad, Math.min(a.left, railBox.right - width - pad, innerWidth - width - pad)),
          below = innerHeight - a.bottom - pad - gap,
          above = a.top - pad - gap,
          flip = below < 160 && above > below;
        Object.assign(panel.style, {
          width: width + 'px',
          left: left + 'px',
          top: flip ? 'auto' : a.bottom + gap + 'px',
          bottom: flip ? innerHeight - a.top + gap + 'px' : 'auto',
          maxHeight: Math.min(400, flip ? above : below) + 'px'
        });
      };
      position();
      addEventListener('resize', position, { signal });
      document.addEventListener(
        'scroll',
        e => {
          if (!panel.contains(e.target)) position();
        },
        { capture: true, signal }
      );
      const outside = e => {
        if (!panel.contains(e.target) && !button.contains(e.target)) close();
      };
      document.addEventListener('pointerdown', outside, { capture: true, signal });
      document.addEventListener('focusin', outside, { signal });
      document.addEventListener(
        'keydown',
        e => {
          if (e.key !== 'Escape') return;
          e.preventDefault();
          e.stopPropagation();
          close(true);
        },
        { capture: true, signal }
      );
    },
    hide() {
      events?.abort();
      if (!panel.hidden) {
        panel.hidePopover?.();
        panel.hidden = true;
      }
      panel.remove();
    }
  };
}
