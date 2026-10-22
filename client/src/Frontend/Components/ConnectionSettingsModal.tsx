import { AztecAddress } from "@aztec/aztec.js/addresses";
import React, { useCallback, useEffect, useState } from "react";
import styled from "styled-components";

import {
  getConnectionOverrides,
  getEffectiveIndexerBootstrapUrl,
  getEffectiveNodeUrl,
  getEffectiveProverUrl,
  getEffectiveQuotaFpcAddress,
  setConnectionOverrides,
} from "../../config/connection";
import {
  getIndexerBootstrapUrl,
  getNodeUrl,
  getProverUrl,
  getQuotaFpcAddressFromEnv,
} from "../../config/env";
import { externalLinks } from "../../config/externalLinks";
import dfstyles from "../Styles/dfstyles";
import { Btn } from "./Btn";
import { Link, Title } from "./CoreUI";
import { TextInput } from "./Input";
import { Modal } from "./Modal";
import { Text } from "./Text";

function isValidHttpUrl(s: string): boolean {
  if (!s.trim()) return false;
  try {
    const u = new URL(s.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

const ConnectionSettingsContent = styled.div`
  box-sizing: border-box;
  width: min(520px, calc(100vw - 32px));
  max-height: calc(100vh - 96px);
  padding-right: 4px;
  overflow-y: auto;
  overflow-x: hidden;
`;

const FeePaymentSection = styled.div`
  margin: 2px 0 12px;
  text-align: left;
`;

const FeePaymentToggle = styled.label`
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 11px 12px;
  border: 1px solid ${dfstyles.colors.borderDark};
  border-radius: ${dfstyles.borderRadius};
  background: ${dfstyles.colors.backgroundlight};
  cursor: pointer;
  text-align: left;

  &:hover {
    border-color: ${dfstyles.colors.subtext};
  }
`;

const FeePaymentCheckbox = styled.input`
  width: 17px;
  height: 17px;
  margin: 2px 0 0;
  flex: 0 0 auto;
  accent-color: ${dfstyles.colors.dfgreen};
  cursor: pointer;
`;

const FeePaymentToggleCopy = styled.span`
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
  line-height: 1.35;
`;

const FeePaymentTitle = styled.span`
  color: ${dfstyles.colors.text};
  font-size: ${dfstyles.fontSize};
`;

const FeePaymentSubtitle = styled.span`
  color: ${dfstyles.colors.subtext};
  font-size: ${dfstyles.fontSizeS};
`;

const FeePaymentDetails = styled.div`
  margin-top: 8px;
  padding: 11px 12px;
  border-left: 2px solid ${dfstyles.colors.dfgreen};
  background: ${dfstyles.colors.background};
  text-align: left;
`;

const FeePaymentStatus = styled.div`
  margin-bottom: 6px;
  color: ${dfstyles.colors.dfgreen};
  font-size: ${dfstyles.fontSizeS};
`;

const FeePaymentHelp = styled.p`
  margin: 0 0 10px;
  color: ${dfstyles.colors.subtext};
  font-size: ${dfstyles.fontSizeS};
  line-height: 1.45;
`;

const FeePaymentFieldLabel = styled.label`
  display: block;
  margin-bottom: 5px;
  color: ${dfstyles.colors.text};
`;

export function ConnectionSettingsModal({
  open,
  onClose,
  anchorPosition,
}: {
  open: boolean;
  onClose: () => void;
  anchorPosition?: { x: number; y: number } | null;
}) {
  const [nodeUrlInput, setNodeUrlInput] = useState("");
  const [indexerUrlInput, setIndexerUrlInput] = useState("");
  const [proverUrlInput, setProverUrlInput] = useState("");
  const [quotaFpcInput, setQuotaFpcInput] = useState("");
  const [useQuotaFpc, setUseQuotaFpc] = useState(true);
  const [saveMessage, setSaveMessage] = useState<
    "saved" | "restored" | "error" | null
  >(null);

  const refreshForm = useCallback(() => {
    setNodeUrlInput(getEffectiveNodeUrl());
    setIndexerUrlInput(getEffectiveIndexerBootstrapUrl() ?? "");
    setProverUrlInput(getEffectiveProverUrl());
    const overrides = getConnectionOverrides();
    setQuotaFpcInput(overrides.quotaFpcAddress?.trim() ?? "");
    setUseQuotaFpc(overrides.useQuotaFpc !== false);
  }, []);

  useEffect(() => {
    if (open) {
      refreshForm();
      setSaveMessage(null);
    }
  }, [open, refreshForm]);

  const handleSave = useCallback(() => {
    const nodeTrimmed = nodeUrlInput.trim();
    const indexerTrimmed = indexerUrlInput.trim();
    const proverTrimmed = proverUrlInput.trim();
    if (!nodeTrimmed) {
      setSaveMessage("error");
      return;
    }
    if (!isValidHttpUrl(nodeTrimmed)) {
      setSaveMessage("error");
      return;
    }
    if (indexerTrimmed && !isValidHttpUrl(indexerTrimmed)) {
      setSaveMessage("error");
      return;
    }
    if (proverTrimmed && !isValidHttpUrl(proverTrimmed)) {
      setSaveMessage("error");
      return;
    }
    const quotaTrimmed = quotaFpcInput.trim();
    if (useQuotaFpc && quotaTrimmed.length > 0) {
      try {
        AztecAddress.fromStringUnsafe(quotaTrimmed);
      } catch {
        setSaveMessage("error");
        return;
      }
    }
    setConnectionOverrides({
      nodeUrl: nodeTrimmed,
      indexerBootstrapUrl: indexerTrimmed || null,
      proverUrl: proverTrimmed || "",
      quotaFpcAddress: quotaTrimmed,
      useQuotaFpc,
    });
    setSaveMessage("saved");
  }, [
    nodeUrlInput,
    indexerUrlInput,
    proverUrlInput,
    quotaFpcInput,
    useQuotaFpc,
  ]);

  const handleRestoreDefault = useCallback(() => {
    setConnectionOverrides({
      nodeUrl: "",
      indexerBootstrapUrl: undefined,
      proverUrl: "",
      quotaFpcAddress: "",
      useQuotaFpc: null,
    });
    setNodeUrlInput(getNodeUrl());
    setIndexerUrlInput(getIndexerBootstrapUrl() ?? "");
    setProverUrlInput(getProverUrl());
    setQuotaFpcInput("");
    setUseQuotaFpc(true);
    setSaveMessage("restored");
  }, []);

  if (!open) return null;

  return (
    <Modal
      contain={["top", "bottom", "left", "right"]}
      initialX={anchorPosition?.x}
      initialY={anchorPosition?.y}
      onMouseDown={(e) => {
        if (
          (e.target as HTMLElement)?.tagName?.toLowerCase() ===
          "darkforest-modal"
        ) {
          onClose();
        }
      }}
    >
      <Title slot="title">Connection settings</Title>
      <ConnectionSettingsContent>
        <p style={{ marginBottom: 8, color: dfstyles.colors.subtext }}>
          Configure before entering the world. Leave indexer empty to sync from
          node.
        </p>
        <label style={{ display: "block", marginBottom: 4 }}>
          <Text>Aztec node URL</Text>
        </label>
        <TextInput
          value={nodeUrlInput}
          onChange={(e) =>
            setNodeUrlInput((e.target as HTMLInputElement).value)
          }
          placeholder={getNodeUrl()}
          style={{ width: "100%", marginBottom: 12 }}
        />
        <label style={{ display: "block", marginBottom: 4 }}>
          <Text>Indexer bootstrap URL (optional)</Text>
        </label>
        <TextInput
          value={indexerUrlInput}
          onChange={(e) =>
            setIndexerUrlInput((e.target as HTMLInputElement).value)
          }
          placeholder="Leave empty to sync from node"
          style={{ width: "100%", marginBottom: 12 }}
        />
        <label style={{ display: "block", marginBottom: 4 }}>
          <Text>Accelerator / prover URL</Text>
        </label>
        <TextInput
          value={proverUrlInput}
          onChange={(e) =>
            setProverUrlInput((e.target as HTMLInputElement).value)
          }
          placeholder={getProverUrl()}
          style={{ width: "100%", marginBottom: 12 }}
        />
        <FeePaymentSection>
          <FeePaymentToggle>
            <FeePaymentCheckbox
              type="checkbox"
              checked={useQuotaFpc}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setUseQuotaFpc(e.target.checked)
              }
            />
            <FeePaymentToggleCopy>
              <FeePaymentTitle>Quota paymaster</FeePaymentTitle>
              <FeePaymentSubtitle>
                Use the project's daily sponsored transaction quota
              </FeePaymentSubtitle>
            </FeePaymentToggleCopy>
          </FeePaymentToggle>

          {useQuotaFpc ? (
            <FeePaymentDetails>
              <FeePaymentStatus>Quota paymaster selected</FeePaymentStatus>
              <FeePaymentHelp>
                Eligible game calls use the project's quota first, then fall
                back to your account when sponsorship is unavailable.
              </FeePaymentHelp>
              <FeePaymentFieldLabel>QuotaFpc address</FeePaymentFieldLabel>
              <TextInput
                value={quotaFpcInput}
                onChange={(e) =>
                  setQuotaFpcInput((e.target as HTMLInputElement).value)
                }
                placeholder={
                  getEffectiveQuotaFpcAddress() ??
                  getQuotaFpcAddressFromEnv() ??
                  "QuotaFpc Aztec address"
                }
                style={{ width: "100%", marginBottom: 7 }}
              />
              <FeePaymentHelp style={{ marginBottom: 0 }}>
                Leave empty to use <code>VITE_QUOTA_FPC_ADDRESS</code>. Address
                changes apply after refresh.
              </FeePaymentHelp>
            </FeePaymentDetails>
          ) : (
            <FeePaymentDetails>
              <FeePaymentStatus>Account FeeJuice selected</FeePaymentStatus>
              <FeePaymentHelp>
                Your account pays transaction fees. Its FeeJuice balance is
                checked after wallet selection.
              </FeePaymentHelp>
              <Link to={externalLinks.aztecMainnet.feeJuiceBridge}>
                Open FeeJuice bridge
              </Link>
            </FeePaymentDetails>
          )}
        </FeePaymentSection>
        {saveMessage === "saved" && (
          <Text
            style={{
              color: dfstyles.colors.dfgreen,
              marginBottom: 8,
              fontSize: dfstyles.fontSizeS,
            }}
          >
            Saved. Will apply when you enter the world.
          </Text>
        )}
        {saveMessage === "restored" && (
          <div
            style={{
              color: dfstyles.colors.dfgreen,
              marginBottom: 8,
              fontSize: dfstyles.fontSizeS,
            }}
          >
            <div>Restored to default.</div>
            <div>Will apply when you enter the world.</div>
          </div>
        )}
        {saveMessage === "error" && (
          <Text style={{ color: dfstyles.colors.dfred, marginBottom: 8 }}>
            Please enter valid HTTP(S) URLs and a valid QuotaFpc address (or
            leave the address empty).
          </Text>
        )}
        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          <Btn size="medium" onClick={handleSave}>
            Save
          </Btn>
          <Btn
            size="medium"
            onClick={handleRestoreDefault}
            style={{ borderColor: dfstyles.colors.subtext }}
          >
            Restore default
          </Btn>
          <Btn
            size="medium"
            onClick={onClose}
            style={{ borderColor: dfstyles.colors.subtext }}
          >
            Close
          </Btn>
        </div>
      </ConnectionSettingsContent>
    </Modal>
  );
}
