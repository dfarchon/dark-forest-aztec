/** One topic per chapter; keep each action visible as its own exercise. */
export const GUIDE_CHAPTERS = [
  {
    id: "planet",
    title: "Your view and home planet",
    steps: ["zoom", "zoomIn", "selectPlanet"],
  },
  {
    id: "move",
    title: "Send energy",
    steps: ["selectMovePlanet", "setEnergy", "pressSend", "clickNearby"],
  },
  {
    id: "ships",
    title: "Move ships",
    steps: [
      "selectShipPlanet",
      "selectShip",
      "pressShipSend",
      "moveShip",
      "deselect",
    ],
  },
  { id: "fog", title: "Explore the fog", steps: ["pressExplore", "clickDark"] },
  {
    id: "controls",
    title: "Explorer and terminal controls",
    steps: ["pauseExplorer", "resumeExplorer", "hideTerminal"],
  },
  {
    id: "review",
    title: "Scoring and account safety",
    steps: ["readScoring", "accountSafety"],
  },
] as const;

export type TaskId = (typeof GUIDE_CHAPTERS)[number]["id"];
export type PageId = "cover" | TaskId | "play";
export type StepId = (typeof GUIDE_CHAPTERS)[number]["steps"][number];

export const TASK_ORDER: TaskId[] = GUIDE_CHAPTERS.map((chapter) => chapter.id);
export const PAGE_ORDER: PageId[] = ["cover", ...TASK_ORDER, "play"];

export function isTask(page: PageId): page is TaskId {
  return TASK_ORDER.includes(page as TaskId);
}

export function chapterSteps(page: PageId): readonly StepId[] {
  return GUIDE_CHAPTERS.find((chapter) => chapter.id === page)?.steps ?? [];
}

export function following(
  page: PageId,
  step: StepId
): { page: PageId; step: StepId | null } {
  const steps = chapterSteps(page);
  const index = steps.indexOf(step);
  if (index >= 0 && index < steps.length - 1)
    return { page, step: steps[index + 1] };
  const nextPage = PAGE_ORDER[PAGE_ORDER.indexOf(page) + 1] ?? "play";
  return { page: nextPage, step: chapterSteps(nextPage)[0] ?? null };
}

export function isPageFinale(page: PageId, step: StepId): boolean {
  const steps = chapterSteps(page);
  return steps.length > 0 && steps[steps.length - 1] === step;
}
