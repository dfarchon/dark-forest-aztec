import { AztecAddress } from "@aztec/aztec.js/addresses";
import React, { useCallback, useEffect, useState } from "react";
import styled from "styled-components";

import {
  getConnectionOverrides,
  getEffectiveIndexerBootstrapUrl,
  getEffectiveNodeUrl,
  getEffectiveProverUrl,
  setConnectionOverrides,
} from "../../config/connection";
import {
  getIndexerBootstrapUrl,
  getNodeUrl,
  getProverUrl,
  getSponsoredFpcAddressFromEnv,
  getSponsorMode,
} from "../../config/env";
import dfstyles from "../Styles/dfstyles";
import { Btn } from "./Btn";
import { Title } from "./CoreUI";
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
  max-width: 400px;
  min-width: 320px;
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
  const [sponsoredFpcInput, setSponsoredFpcInput] = useState("");
  const [saveMessage, setSaveMessage] = useState<
    "saved" | "restored" | "error" | null
  >(null);

  const sponsorMode = getSponsorMode();

  const refreshForm = useCallback(() => {
    setNodeUrlInput(getEffectiveNodeUrl());
    setIndexerUrlInput(getEffectiveIndexerBootstrapUrl() ?? "");
    setProverUrlInput(getEffectiveProverUrl());
    const localSponsor = getConnectionOverrides().sponsoredFpcAddress;
    setSponsoredFpcInput(
      localSponsor !== undefined && localSponsor !== null
        ? localSponsor.trim()
        : ""
    );
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
    const sponsorTrimmed = sponsoredFpcInput.trim();
    if (sponsorMode && sponsorTrimmed.length > 0) {
      try {
        AztecAddress.fromString(sponsorTrimmed);
      } catch {
        setSaveMessage("error");
        return;
      }
    }
    setConnectionOverrides({
      nodeUrl: nodeTrimmed,
      indexerBootstrapUrl: indexerTrimmed || null,
      proverUrl: proverTrimmed || "",
      ...(sponsorMode
        ? {
            sponsoredFpcAddress:
              sponsorTrimmed.length > 0 ? sponsorTrimmed : "",
          }
        : {}),
    });
    setSaveMessage("saved");
  }, [
    nodeUrlInput,
    indexerUrlInput,
    proverUrlInput,
    sponsoredFpcInput,
    sponsorMode,
  ]);

  const handleRestoreDefault = useCallback(() => {
    setConnectionOverrides({
      nodeUrl: "",
      indexerBootstrapUrl: undefined,
      proverUrl: "",
      ...(sponsorMode ? { sponsoredFpcAddress: "" } : {}),
    });
    setNodeUrlInput(getNodeUrl());
    setIndexerUrlInput(getIndexerBootstrapUrl() ?? "");
    setProverUrlInput(getProverUrl());
    setSponsoredFpcInput("");
    setSaveMessage("restored");
  }, [sponsorMode]);

  if (!open) return null;

  return (
    <Modal
      contain={["top", "left", "right"]}
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
        {sponsorMode && (
          <>
            <label style={{ display: "block", marginBottom: 4 }}>
              <Text>SponsoredFPC address (sponsor gas)</Text>
            </label>
            <p
              style={{
                margin: "0 0 8px",
                fontSize: dfstyles.fontSizeS,
                color: dfstyles.colors.subtext,
              }}
            >
              Leave empty to use build default (
              <code>VITE_SPONSORED_FPC_ADDRESS</code> or canonical salt-derived
              instance). Save, then refresh the page so the wallet picks it up.
            </p>
            <TextInput
              value={sponsoredFpcInput}
              onChange={(e) =>
                setSponsoredFpcInput((e.target as HTMLInputElement).value)
              }
              placeholder={
                getSponsoredFpcAddressFromEnv() ?? "Optional Aztec address"
              }
              style={{ width: "100%", marginBottom: 12 }}
            />
          </>
        )}
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
            {sponsorMode
              ? "Please enter valid HTTP(S) URLs and a valid Aztec SponsoredFPC address (or leave sponsor empty)."
              : "Please enter valid HTTP(S) URLs."}
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
