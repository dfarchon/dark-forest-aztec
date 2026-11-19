export function terminalGuide(reveal: string | undefined) {
  return reveal === "bar"
    ? {
        target: "terminal-toggle",
        gesture: "click" as const,
        hint: "The terminal is a read-only log on the right. Click the arrow on the far-right bar to hide the terminal. Click it again to reopen it.",
      }
    : {
        target: "terminal-edge",
        gesture: "hover" as const,
        hint: "The terminal is a read-only log on the right. Hover over the far-right edge to hide the terminal. Move away and hover over the edge again to reopen it.",
      };
}
