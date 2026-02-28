import { RECOMMENDED_MODAL_WIDTH } from "@dfpunk/constants";
import { ModalName } from "@dfpunk/types";
import React, { useEffect, useState } from "react";
import styled from "styled-components";

import type { WorldConfig } from "../../Backend/GameLogic/GameManager";
import { Btn } from "../Components/Btn";
import {
  Section,
  SectionHeader,
  Separator,
  Spacer,
} from "../Components/CoreUI";
import { Slider } from "../Components/Slider";
import { Green, Red } from "../Components/Text";
import { useUIManager } from "../Utils/AppHooks";
import { useEmitterValue } from "../Utils/EmitterHooks";
import { ModalPane } from "../Views/ModalPane";

const SPEED_MIN = 1;
const SPEED_MAX = 6000;

function clampSpeed(speed: number): number {
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.round(speed)));
}

function toNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatSpeedMultiplier(speedHundredths: number): string {
  return `${(speedHundredths / 100).toFixed(2).replace(/\.?0+$/, "")}x`;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function AdminControlsPane({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const uiManager = useUIManager();
  const paused = useEmitterValue(uiManager.getPaused$(), uiManager.getPaused());

  const [worldConfig, setWorldConfig] = useState<WorldConfig | undefined>();
  const [speedHundredths, setSpeedHundredths] = useState<number>(100);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [updatingSpeed, setUpdatingSpeed] = useState(false);
  const [updatingPause, setUpdatingPause] = useState(false);
  const [status, setStatus] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!visible) return;

    let cancelled = false;

    const loadWorldConfig = async () => {
      setLoadingConfig(true);
      setError(undefined);
      setStatus(undefined);

      try {
        // TODO(review-1): getWorldConfig() currently reads through cache; add a fresh-read path
        // for admin edits so we don't base updates on stale config.
        const config = await uiManager.getWorldConfig();
        if (cancelled) return;

        setWorldConfig(config);
        setSpeedHundredths(
          clampSpeed(toNumber(config.time_factor_hundredths, 100))
        );
      } catch (loadError) {
        if (cancelled) return;
        setError(getErrorMessage(loadError));
      } finally {
        if (!cancelled) {
          setLoadingConfig(false);
        }
      }
    };

    void loadWorldConfig();

    return () => {
      cancelled = true;
    };
  }, [uiManager, visible]);

  const currentConfigSpeed = worldConfig
    ? clampSpeed(toNumber(worldConfig.time_factor_hundredths, speedHundredths))
    : speedHundredths;
  const speedChanged = worldConfig
    ? currentConfigSpeed !== speedHundredths
    : false;

  const updateGameSpeed = async () => {
    if (!worldConfig) return;

    setUpdatingSpeed(true);
    setError(undefined);
    setStatus(undefined);

    try {
      // TODO(review-1): This full-struct spread can overwrite concurrent changes in
      // untouched fields; use fresh read + concurrency guard before submit.
      const nextConfig: WorldConfig = {
        ...worldConfig,
        time_factor_hundredths: speedHundredths,
      };
      const tx = await uiManager.setWorldConfig(nextConfig);
      await tx.confirmedPromise;

      const refreshedConfig = await uiManager.getWorldConfig();
      setWorldConfig(refreshedConfig);
      setSpeedHundredths(
        clampSpeed(
          toNumber(refreshedConfig.time_factor_hundredths, speedHundredths)
        )
      );
      setStatus("Game speed updated.");
    } catch (updateError) {
      setError(getErrorMessage(updateError));
    } finally {
      setUpdatingSpeed(false);
    }
  };

  const togglePause = async () => {
    setUpdatingPause(true);
    setError(undefined);
    setStatus(undefined);

    try {
      const tx = paused
        ? await uiManager.unpauseGame()
        : await uiManager.pauseGame();
      await tx.confirmedPromise;
      setStatus(paused ? "Game unpaused." : "Game paused.");
    } catch (pauseError) {
      setError(getErrorMessage(pauseError));
    } finally {
      setUpdatingPause(false);
    }
  };

  return (
    <ModalPane
      id={ModalName.AdminControls}
      title="Admin Controls"
      visible={visible}
      onClose={onClose}
      width={RECOMMENDED_MODAL_WIDTH}
    >
      <Container>
        <Section>
          <SectionHeader>Game Speed</SectionHeader>
          <Slider
            variant="filled"
            label="Time factor (hundredths)"
            min={SPEED_MIN}
            max={SPEED_MAX}
            step={1}
            value={speedHundredths}
            onChange={(e: unknown) => {
              const target = (e as { target?: { value?: unknown } }).target;
              setSpeedHundredths(
                clampSpeed(toNumber(target?.value, speedHundredths))
              );
            }}
          />
          <Spacer height={8} />
          <Row>
            <span>Current multiplier</span>
            <span>{formatSpeedMultiplier(speedHundredths)}</span>
          </Row>
          <Spacer height={8} />
          <Btn
            size="stretch"
            disabled={
              loadingConfig || updatingSpeed || updatingPause || !speedChanged
            }
            onClick={updateGameSpeed}
          >
            {updatingSpeed ? "Updating Game Speed..." : "Update Game Speed"}
          </Btn>
        </Section>

        <Separator />

        <Section>
          <SectionHeader>Pause / Unpause</SectionHeader>
          <Row>
            <span>Current state</span>
            <PauseState paused={paused}>
              {paused ? "PAUSED" : "RUNNING"}
            </PauseState>
          </Row>
          <Spacer height={8} />
          <Btn
            size="stretch"
            disabled={loadingConfig || updatingPause || updatingSpeed}
            onClick={togglePause}
          >
            {updatingPause
              ? paused
                ? "Unpausing..."
                : "Pausing..."
              : paused
                ? "Unpause Game"
                : "Pause Game"}
          </Btn>
        </Section>

        {loadingConfig && <Message>Loading admin configuration...</Message>}
        {status && (
          <Message>
            <Green>{status}</Green>
          </Message>
        )}
        {error && (
          <Message>
            <Red>{error}</Red>
          </Message>
        )}
      </Container>
    </ModalPane>
  );
}

const Container = styled.div`
  width: 360px;
`;

const Row = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const PauseState = styled.span<{ paused: boolean }>`
  font-weight: bold;
  color: ${({ paused }) => (paused ? "#f58f8f" : "#7ce7a0")};
`;

const Message = styled.div`
  margin-top: 8px;
`;
