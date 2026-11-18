import React from "react";

import { GuideOverlay } from "./GuideOverlay";
import { GuidePanel } from "./GuidePanel";
import { useGuideController } from "./useGuideController";

/** Compose the guide; chapter behavior, game adapters and rendering stay separate. */
export function PlayerGuidePane({
  onComplete,
  onClose,
}: {
  onComplete: () => void;
  onClose: () => void;
}) {
  const controller = useGuideController(onComplete);
  return (
    <>
      <GuideOverlay controller={controller} />
      <GuidePanel controller={controller} onClose={onClose} />
    </>
  );
}
