import type { ForkDivergence } from "@dfpunk/indexer-core";
import React, { useCallback, useEffect, useRef, useState } from "react";
import styled from "styled-components";

import dfstyles from "../Styles/dfstyles";

const FORK_RELOAD_SECONDS = 6;
const FORK_RELOAD_NOTICE_KEY = "dfpunk.forkDivergenceNotice";

const FORK_PREVIEW_SAMPLE: ForkDivergence = {
  processedBlock: 128_440,
  processedBlockHash:
    "0xabababababababababababababababababababababababababababababababab",
  nodeHash:
    "0xcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd",
  tip: 128_512,
};

/** Optional fields for `ui.previewForkDiverged`. `nodeHash: null` omits the node hash. */
export interface ForkNoticePreview {
  processedBlock?: number;
  processedBlockHash?: string;
  nodeHash?: string | null;
  tip?: number;
}

type ForkNoticeState = {
  divergence: ForkDivergence;
  secondsLeft: number;
};

type ForkNoticeControls = {
  show: (divergence: ForkDivergence) => void;
};

let controls: ForkNoticeControls | null = null;

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

function resolveForkPreview(sample?: ForkNoticePreview): ForkDivergence {
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
  return divergence;
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

/** Shows the fork notice, counts down, then reloads. No-op if one is already in progress. */
export function showForkDivergence(divergence: ForkDivergence): void {
  if (!controls) {
    console.warn("[ui] fork notice is not mounted");
    return;
  }
  controls.show(divergence);
}

/** Same countdown and reload as a real fork. Used by `ui.previewForkDiverged()`. */
export function previewForkDiverged(sample?: ForkNoticePreview): void {
  showForkDivergence(resolveForkPreview(sample));
}

export function ForkDivergenceNotice() {
  const [notice, setNotice] = useState<ForkNoticeState | null>(null);
  const tokenRef = useRef(0);
  const liveRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  const show = useCallback((divergence: ForkDivergence) => {
    if (liveRef.current) return;
    liveRef.current = true;
    const token = ++tokenRef.current;
    rememberForkReload(divergence);
    const startedAt = Date.now();
    setNotice({ divergence, secondsLeft: FORK_RELOAD_SECONDS });
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => {
      if (tokenRef.current !== token) return;
      const elapsed = Date.now() - startedAt;
      if (elapsed >= FORK_RELOAD_SECONDS * 1000) {
        if (timerRef.current !== null) window.clearInterval(timerRef.current);
        timerRef.current = null;
        window.location.reload();
        return;
      }
      const secondsLeft = FORK_RELOAD_SECONDS - Math.floor(elapsed / 1000);
      setNotice((current) => (current ? { ...current, secondsLeft } : current));
    }, 200);
  }, []);

  useEffect(() => {
    const next = { show };
    controls = next;
    return () => {
      if (controls === next) controls = null;
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
    };
  }, [show]);

  if (!notice) return null;

  const secondsLabel = notice.secondsLeft === 1 ? "second" : "seconds";

  return (
    <ForkDivergenceTransition
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="fork-divergence-title"
    >
      <ForkDivergenceCard>
        <strong id="fork-divergence-title">Block fork</strong>
        <p>
          The chain forked. Block{" "}
          {notice.divergence.processedBlock.toLocaleString()} was proposed
          earlier and did not land on chain.
        </p>
        <ForkCountdown aria-live="polite">
          <span>This page reloads in</span>
          <b>{notice.secondsLeft}</b>
          <span>{secondsLabel}</span>
        </ForkCountdown>
      </ForkDivergenceCard>
    </ForkDivergenceTransition>
  );
}

const ForkDivergenceTransition = styled.div`
  position: fixed;
  inset: 0;
  z-index: 4600;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  pointer-events: auto;
  background: rgba(8, 0, 0, 0.72);
  animation: fork-veil-live 700ms ease-out forwards;

  @keyframes fork-veil-live {
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

const ForkCountdown = styled.div`
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-top: 22px;
  color: ${dfstyles.colors.dfyellow};

  span {
    font-size: 14px;
    letter-spacing: 0.04em;
  }

  b {
    min-width: 1.2ch;
    color: ${dfstyles.colors.textLight};
    font-size: 42px;
    font-weight: 400;
    line-height: 1;
  }
`;
