import type { StepId } from "./guideChapters";

export function needsGuideMouse(step: StepId): boolean {
  return !["zoom", "zoomIn", "readScoring", "accountSafety"].includes(step);
}

/** A demonstration may authorize its action once, only for its original lesson. */
export class GuideAssistGate {
  private nextId = 0;
  private request: { id: number; entry: number } | undefined;
  begin(entry: number): number {
    const id = ++this.nextId;
    this.request = { id, entry };
    return id;
  }
  complete(id: number, entry: number): boolean {
    if (this.request?.id !== id || this.request.entry !== entry) return false;
    this.request = undefined;
    return true;
  }
  isCurrent(id: number): boolean {
    return this.request?.id === id;
  }
  cancel(): void {
    this.request = undefined;
  }
}
