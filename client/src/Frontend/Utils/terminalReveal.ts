/** Let a quick click replace the pending hover toggle, rather than toggle twice. */
export class TerminalRevealController {
  private hovered = false;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private readonly toggle: () => void) {}

  enter = () => {
    if (this.hovered) return;
    this.hovered = true;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.toggle();
    }, 250);
  };

  leave = () => {
    this.hovered = false;
    this.cancelPending();
  };

  click = () => {
    this.cancelPending();
    this.toggle();
  };

  private cancelPending() {
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
