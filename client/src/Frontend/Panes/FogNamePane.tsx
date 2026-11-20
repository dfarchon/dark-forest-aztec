import { RECOMMENDED_MODAL_WIDTH } from "@dfpunk/constants";
import { ModalId, TooltipName } from "@dfpunk/types";
import React, { useEffect, useMemo, useState } from "react";
import styled from "styled-components";

import { Hook } from "../../_types/global/GlobalTypes";
import {
  destroyFogNameService,
  FOG_NAMESERVER_URL,
  FogError,
  getFogNameService,
  normalizeRootFogName,
  useFogNameState,
} from "../../Session/FogName";
import { Btn } from "../Components/Btn";
import { Link } from "../Components/CoreUI";
import { TextInput } from "../Components/Input";
import { LoadingSpinner } from "../Components/LoadingSpinner";
import { Green, Red, Sub, Text, White } from "../Components/Text";
import dfstyles from "../Styles/dfstyles";
import { useUIManager } from "../Utils/AppHooks";
import { ModalPane } from "../Views/ModalPane";
import { TooltipTrigger } from "./Tooltip";

export const FOG_NAME_MODAL_ID = "FogName" as ModalId;

export function FogNameButton({ hook: [, setOpen] }: { hook: Hook<boolean> }) {
  return (
    <TooltipTrigger
      name={TooltipName.Empty}
      extraContent={<Text>Connect or manage your .fog primary name.</Text>}
    >
      <Btn size="small" onClick={() => setOpen((v) => !v)}>
        .fog
      </Btn>
    </TooltipTrigger>
  );
}

const Stack = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const StepCard = styled(Stack)`
  padding: 10px;
  background: ${dfstyles.colors.backgrounddark};
  border: 1px solid ${dfstyles.colors.borderDark};
  border-radius: 3px;
`;

const MonoBox = styled.div`
  font-family: monospace;
  font-size: 0.85em;
  word-break: break-all;
  padding: 6px 8px;
  background: ${dfstyles.colors.background};
  border: 1px solid ${dfstyles.colors.borderDarker};
  border-radius: 3px;
`;

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;

function describeError(err: unknown): string {
  if (err instanceof FogError) {
    if (err.code === "forward_mismatch") {
      return "This .fog name does not point to your game address yet. Complete Step 1 in the Fog Names app first.";
    }
    if (err.code === "not_active") {
      return "This .fog name is unregistered or expired.";
    }
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * ENS-style Primary Name modal (`setAddr` on Fog Names app + `set_primary` reverse claim in-game).
 */
export function FogNamePane({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const uiManager = useUIManager();
  const service = getFogNameService(uiManager)!;
  const state = useFogNameState(uiManager);

  useEffect(() => () => destroyFogNameService(uiManager), [uiManager]);

  const burnerAddress = state?.activeBurnerAddress;
  const [copied, setCopied] = useState(false);
  const [primaryInput, setPrimaryInput] = useState("");
  const [busy, setBusy] = useState<"confirm" | "clear" | "refresh" | null>(
    null
  );
  const [feedback, setFeedback] = useState<{
    kind: "ok" | "err";
    text: string;
  }>();

  useEffect(() => {
    setCopied(false);
    setFeedback(undefined);
  }, [burnerAddress]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);

  const parsedInput = useMemo(() => {
    const trimmed = primaryInput.trim();
    if (!trimmed) return undefined;
    try {
      return { ok: true as const, label: normalizeRootFogName(trimmed) };
    } catch (err) {
      return { ok: false as const, reason: describeError(err) };
    }
  }, [primaryInput]);

  const primary = state?.activePrimary;
  const isVerified =
    primary?.status === "verified" && Boolean(primary.formattedName);
  const manageLabel =
    (parsedInput?.ok ? parsedInput.label.label : undefined) ??
    primary?.canonicalLabel;
  const writesReady = Boolean(state?.writesEnabled) && busy === null;

  const runAction = async (
    mode: "confirm" | "clear" | "refresh",
    fn: () => Promise<string | undefined>
  ) => {
    setFeedback(undefined);
    setBusy(mode);
    try {
      const text = await fn();
      if (text) setFeedback({ kind: "ok", text });
    } catch (err) {
      setFeedback({ kind: "err", text: describeError(err) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <ModalPane
      id={FOG_NAME_MODAL_ID}
      title="Connect .fog Name"
      visible={visible}
      onClose={onClose}
      width={RECOMMENDED_MODAL_WIDTH}
    >
      <Stack>
        <Row style={{ justifyContent: "space-between" }}>
          <Row>
            <Sub>Status:</Sub>
            {isVerified ? (
              <Green>Connected as {primary!.formattedName}</Green>
            ) : primary?.status === "stale" ? (
              <Red>Unverified ({primary.reason ?? "record changed"})</Red>
            ) : (
              <Sub>Not connected</Sub>
            )}
          </Row>
          <Btn
            size="small"
            disabled={busy !== null}
            onClick={() =>
              void runAction("refresh", async () => {
                await service.refreshNow();
                return undefined;
              })
            }
          >
            {busy === "refresh" ? "Refreshing..." : "Refresh"}
          </Btn>
        </Row>

        {state?.statusMessage && <Red>{state.statusMessage}</Red>}
        {!state?.writesEnabled && state?.writesDisabledReason && (
          <Sub>{state.writesDisabledReason}</Sub>
        )}

        <StepCard>
          <White>Step 1 — Point your .fog name to this game address</White>
          <Sub>
            Copy your active game address below and set it as your{" "}
            <White>.fog</White> name&apos;s Aztec address in the Fog Names app.
          </Sub>
          <MonoBox>{burnerAddress ?? "<no active burner>"}</MonoBox>
          <Row>
            <Btn
              size="small"
              disabled={!burnerAddress}
              onClick={() => {
                if (!burnerAddress) return;
                void navigator.clipboard
                  .writeText(burnerAddress)
                  .then(() => setCopied(true))
                  .catch(() => setCopied(false));
              }}
            >
              {copied ? "Copied" : "Copy Address"}
            </Btn>
            <Link to={`${FOG_NAMESERVER_URL}/#/register`}>Register .fog</Link>
            <Link to={`${FOG_NAMESERVER_URL}/#/names`}>My Names</Link>
            {manageLabel && (
              <Link
                to={`${FOG_NAMESERVER_URL}/#/manage/${encodeURIComponent(manageLabel)}`}
              >
                Manage {manageLabel}.fog
              </Link>
            )}
          </Row>
        </StepCard>

        <StepCard>
          <White>Step 2 — Set Primary Name</White>
          <Sub>
            Sign with your game account to confirm this <White>.fog</White> name
            as your primary display name.
          </Sub>
          <TextInput
            placeholder="alice.fog"
            value={primaryInput}
            onChange={(e: Event) =>
              setPrimaryInput((e.target as HTMLInputElement).value)
            }
          />
          {parsedInput && !parsedInput.ok && <Red>{parsedInput.reason}</Red>}
          <Btn
            size="stretch"
            disabled={!writesReady || !parsedInput?.ok}
            onClick={() =>
              void runAction("confirm", async () => {
                const res = await service.confirmPrimary(
                  primaryInput,
                  burnerAddress
                );
                setPrimaryInput("");
                return `Primary name set to ${res.formattedName ?? "name"} (tx ${res.txHash.slice(0, 14)}...).`;
              })
            }
          >
            {busy === "confirm" ? (
              <LoadingSpinner initialText="Setting primary..." />
            ) : (
              "Set Primary Name"
            )}
          </Btn>
          {isVerified && (
            <Btn
              size="stretch"
              disabled={!writesReady}
              onClick={() =>
                void runAction("clear", async () => {
                  const res = await service.clearAccountPrimary(burnerAddress);
                  return `Cleared primary name (tx ${res.txHash.slice(0, 14)}...).`;
                })
              }
            >
              {busy === "clear" ? (
                <LoadingSpinner initialText="Clearing..." />
              ) : (
                "Disconnect Primary Name"
              )}
            </Btn>
          )}
        </StepCard>

        {feedback &&
          (feedback.kind === "ok" ? (
            <Green>{feedback.text}</Green>
          ) : (
            <Red>{feedback.text}</Red>
          ))}
      </Stack>
    </ModalPane>
  );
}
