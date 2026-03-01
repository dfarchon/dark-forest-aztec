/**
 * Memory Monitor — Show JS heap usage (Chrome: performance.memory).
 * Embedded plugin for dfpunk-aztec. No df/ui required.
 * Note: performance.memory is Chrome-only; other browsers show "N/A".
 */

export default class Plugin {
  #root = null;
  #destroyed = false;

  render(container) {
    this.#root = document.createElement("div");
    this.#root.className = "memory-monitor";
    this.#root.innerHTML = this.renderHTML();
    Object.assign(container.style, { width: "280px", minHeight: "120px" });
    container.appendChild(this.#root);
    this.runUpdate();
  }

  async runUpdate() {
    const memory = window.performance?.memory;
    const hasMemory = memory && typeof memory.usedJSHeapSize === "number";

    while (!this.#destroyed && this.#root) {
      if (hasMemory) {
        const usedMB = Math.round(memory.usedJSHeapSize / (1024 * 1024));
        const totalMB = Math.round(memory.totalJSHeapSize / (1024 * 1024));
        const limitMB = Math.round(memory.jsHeapSizeLimit / (1024 * 1024));
        const pct =
          memory.jsHeapSizeLimit > 0
            ? Math.round((memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100)
            : 0;

        const usedEl = this.#root.querySelector("[data-memory-used]");
        const totalEl = this.#root.querySelector("[data-memory-total]");
        const limitEl = this.#root.querySelector("[data-memory-limit]");
        const usageEl = this.#root.querySelector("[data-memory-usage]");
        if (usedEl) usedEl.textContent = `${usedMB} MB`;
        if (totalEl) totalEl.textContent = `${totalMB} MB`;
        if (limitEl) limitEl.textContent = `${limitMB} MB`;
        if (usageEl) usageEl.textContent = `${pct}%`;
      } else {
        const usedEl = this.#root.querySelector("[data-memory-used]");
        if (usedEl) usedEl.textContent = "N/A (Chrome only)";
      }

      await new Promise((r) => setTimeout(r, 1000));
      await new Promise((r) => requestAnimationFrame(r));
    }
  }

  destroy() {
    this.#destroyed = true;
    if (this.#root?.parentNode) this.#root.remove();
    this.#root = null;
  }

  renderHTML() {
    return `
      <table style="width:100%;border-collapse:collapse;color:#e4e4e4;font-size:13px">
        <tbody>
          <tr><th scope="row" style="text-align:left;padding:6px 8px;color:#838383">Used:</th><td data-memory-used style="padding:6px 8px;border-bottom:1px solid #5a6268">—</td></tr>
          <tr><th scope="row" style="text-align:left;padding:6px 8px;color:#838383">Total:</th><td data-memory-total style="padding:6px 8px;border-bottom:1px solid #5a6268">—</td></tr>
          <tr><th scope="row" style="text-align:left;padding:6px 8px;color:#838383">Limit:</th><td data-memory-limit style="padding:6px 8px;border-bottom:1px solid #5a6268">—</td></tr>
          <tr><th scope="row" style="text-align:left;padding:6px 8px;color:#838383">Usage:</th><td data-memory-usage style="padding:6px 8px;border-bottom:1px solid #5a6268">—</td></tr>
        </tbody>
      </table>
    `;
  }
}
