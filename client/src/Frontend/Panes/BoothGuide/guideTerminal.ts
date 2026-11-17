export function terminalGuide(reveal: string | undefined) {
  return reveal === "bar"
    ? {
        target: "terminal-toggle",
        gesture: "click" as const,
        hint: "The terminal is a read-only log on the right. Click the terminal icon at the far-right edge to hide it; click it again to reopen it.",
      }
    : {
        target: "terminal-edge",
        gesture: "hover" as const,
        hint: "The terminal is a read-only log on the right. Hover over the far-right edge or click its terminal icon to hide it. Move away and return to hover again, or click the icon to reopen it.",
      };
}
