import type { ForkDivergence } from "@dfpunk/indexer-core";
import React, { useCallback, useEffect, useRef, useState } from "react";
import styled from "styled-components";

import dfstyles from "../Styles/dfstyles";

const FORK_NOTICE_MS = 4600;
const FORK_RELOAD_NOTICE_KEY = "dfpunk.forkDivergenceNotice";

const FORK_PREVIEW_SAMPLE: ForkDivergence = {
  processedBlock: 128_440,
  processedBlockHash:
    "0xabababababababababababababababababababababababababababababababab",
  nodeHash:
    "0xcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd",
  tip: 128_512,
};

/** Fields for `ui.previewForkDiverged`. `nodeHash: null` omits the node hash. */
export interface ForkNoticePreview {
  processedBlock?: number;
  processedBlockHash?: string;
  nodeHash?: string | null;
  tip?: number;
  /** Keep the notice up until `ui.dismissForkDiverged()`. */
  hold?: boolean;
}

type ForkNoticeState = {
  divergence: ForkDivergence;
  preview: boolean;
  hold: boolean;
};

type ForkNoticeControls = {
  show: (divergence: ForkDivergence) => void;
  preview: (sample?: ForkNoticePreview) => void;
  dismiss: () => void;
};

let controls: ForkNoticeControls | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rememberForkReload(divergence: ForkDivergence): void {
  try {
    sessionStorage.setItem(
      FORK_RELOAD_NOTICE_KEY,
      JSON.stringify({
        processedBlock: divergence.processedBlock,
        tip: divergence.tip,
      })
    );
  } catch {
    // Private mode can reject sessionStorage. The overlay still explains it.
  }
}

function resolveForkPreview(sample?: ForkNoticePreview): {
  divergence: ForkDivergence;
  hold: boolean;
} {
  const divergence: ForkDivergence = {
    processedBlock:
      sample?.processedBlock ?? FORK_PREVIEW_SAMPLE.processedBlock,
    processedBlockHash:
      sample?.processedBlockHash ?? FORK_PREVIEW_SAMPLE.processedBlockHash,
    tip: sample?.tip ?? FORK_PREVIEW_SAMPLE.tip,
  };
  if (typeof sample?.nodeHash === "string") {
    divergence.nodeHash = sample.nodeHash;
  } else if (
    sample?.nodeHash !== null &&
    FORK_PREVIEW_SAMPLE.nodeHash !== undefined
  ) {
    divergence.nodeHash = FORK_PREVIEW_SAMPLE.nodeHash;
  }
  return { divergence, hold: sample?.hold === true };
}

/** One terminal line describing a real divergence. */
export function forkDivergenceTerminalLine(divergence: ForkDivergence): string {
  return (
    `Block fork at block ${divergence.processedBlock.toLocaleString()}. ` +
    `A block proposed earlier did not land on chain. Reloading.`
  );
}

/** Reads and clears the note left for the terminal after a fork reload. */
export function consumeForkReloadNotice(): string | null {
  try {
    const raw = sessionStorage.getItem(FORK_RELOAD_NOTICE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(FORK_RELOAD_NOTICE_KEY);
    const parsed = JSON.parse(raw) as {
      processedBlock?: unknown;
      tip?: unknown;
    };
    if (typeof parsed.processedBlock !== "number") return null;
    return (
      `Reloaded after a block fork. Block ${parsed.processedBlock.toLocaleString()} ` +
      `was proposed earlier and did not land on chain.`
    );
  } catch {
    return null;
  }
}

/** Shows the fork notice, then reloads. No-op if one is already in progress. */
export function showForkDivergence(divergence: ForkDivergence): void {
  if (!controls) {
    console.warn("[ui] fork notice is not mounted");
    return;
  }
  controls.show(divergence);
}

/** Plays the notice without reloading. Used by `ui.previewForkDiverged()`. */
export function previewForkDiverged(sample?: ForkNoticePreview): void {
  if (!controls) {
    console.warn("[ui] fork notice is not mounted");
    return;
  }
  controls.preview(sample);
}

/** Closes a held preview. A real fork still reloads. */
export function dismissForkDiverged(): void {
  controls?.dismiss();
}

export function ForkDivergenceNotice() {
  const [notice, setNotice] = useState<ForkNoticeState | null>(null);
  const tokenRef = useRef(0);
  const liveRef = useRef(false);

  const show = useCallback((divergence: ForkDivergence) => {
    if (liveRef.current) return;
    liveRef.current = true;
    const token = ++tokenRef.current;
    rememberForkReload(divergence);
    setNotice({ divergence, preview: false, hold: false });
    void sleep(FORK_NOTICE_MS).then(() => {
      if (tokenRef.current !== token) return;
      window.location.reload();
    });
  }, []);

  const preview = useCallback((sample?: ForkNoticePreview) => {
    if (liveRef.current) {
      console.warn("[ui] a real fork notice is already showing");
      return;
    }
    const resolved = resolveForkPreview(sample);
    const token = ++tokenRef.current;
    setNotice({
      divergence: resolved.divergence,
      preview: true,
      hold: resolved.hold,
    });
    if (resolved.hold) return;
    void sleep(FORK_NOTICE_MS).then(() => {
      if (tokenRef.current !== token) return;
      setNotice((current) => (current?.preview ? null : current));
    });
  }, []);

  const dismiss = useCallback(() => {
    if (liveRef.current) return;
    tokenRef.current += 1;
    setNotice(null);
  }, []);

  useEffect(() => {
    const next = { show, preview, dismiss };
    controls = next;
    return () => {
      if (controls === next) controls = null;
    };
  }, [show, preview, dismiss]);

  useEffect(() => {
    if (!notice?.preview) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [notice?.preview, dismiss]);

  if (!notice) return null;

  return (
    <ForkDivergenceTransition
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="fork-divergence-title"
      $mode={notice.hold ? "hold" : notice.preview ? "preview" : "live"}
    >
      <ForkDivergenceCard>
        <strong id="fork-divergence-title">Block fork</strong>
        <p>
          The chain forked. Block{" "}
          {notice.divergence.processedBlock.toLocaleString()} was proposed
          earlier and did not land on chain. This page will reload.
        </p>
      </ForkDivergenceCard>
    </ForkDivergenceTransition>
  );
}

const ForkDivergenceTransition = styled.div<{
  $mode: "live" | "preview" | "hold";
}>`
  position: fixed;
  inset: 0;
  z-index: 4600;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  pointer-events: auto;
  background: rgba(8, 0, 0, 0.72);
  animation: ${({ $mode }) =>
    $mode === "hold"
      ? "fork-veil-hold 700ms ease-out forwards"
      : $mode === "preview"
        ? `fork-veil-preview ${FORK_NOTICE_MS}ms ease-in forwards`
        : `fork-veil-live ${FORK_NOTICE_MS}ms ease-out forwards`};

  @keyframes fork-veil-live {
    0% {
      opacity: 0;
    }
    12% {
      opacity: 1;
    }
    100% {
      opacity: 1;
    }
  }

  @keyframes fork-veil-preview {
    0% {
      opacity: 0;
    }
    10% {
      opacity: 1;
    }
    78% {
      opacity: 1;
    }
    100% {
      opacity: 0;
    }
  }

  @keyframes fork-veil-hold {
    0% {
      opacity: 0;
    }
    100% {
      opacity: 1;
    }
  }
`;

const ForkDivergenceCard = styled.div`
  position: relative;
  z-index: 1;
  width: min(560px, calc(100vw - 48px));
  padding: 28px 32px 24px;
  border: 1px solid rgba(232, 226, 40, 0.85);
  background: #100c00;
  color: ${dfstyles.colors.text};
  text-align: left;
  font-family: monospace;

  strong {
    display: block;
    color: ${dfstyles.colors.dfyellow};
    font-size: clamp(22px, 3vw, 32px);
    font-weight: 400;
    letter-spacing: 0.06em;
  }

  p {
    margin: 14px 0 0;
    color: ${dfstyles.colors.text};
    font-size: 14px;
    line-height: 1.45;
  }
`;
