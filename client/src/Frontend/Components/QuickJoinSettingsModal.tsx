import React, { useCallback, useEffect, useState } from "react";
import styled from "styled-components";

import {
  clearQuickJoinDefaultAccount,
  getQuickJoinDefaultAccount,
  setQuickJoinDefaultAccount,
} from "../../config/quickJoin";
import { KeyStore } from "../../Session/WalletManager/KeyStore";
import type { AccountRecord } from "../../Session/WalletManager/types";
import dfstyles from "../Styles/dfstyles";
import { Btn } from "./Btn";
import { Title } from "./CoreUI";
import { Modal } from "./Modal";
import { Text } from "./Text";

function shortAddress(address: string): string {
  if (address.length <= 18) return address;
  return `${address.slice(0, 10)}...${address.slice(-8)}`;
}

const Content = styled.div`
  width: min(520px, calc(100vw - 64px));
  max-width: 520px;
  min-width: 300px;
  padding: 4px 2px 2px;
`;

const Intro = styled.p`
  margin: 0 0 14px;
  color: ${dfstyles.colors.subtext};
  font-size: ${dfstyles.fontSizeS};
  line-height: 1.45;
`;

const AccountList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
`;

const AccountRow = styled.label<{ $selected?: boolean }>`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid
    ${({ $selected }) =>
      $selected ? dfstyles.colors.dfgreen : dfstyles.colors.borderDarker};
  border-radius: ${dfstyles.borderRadius};
  background: ${({ $selected }) =>
    $selected ? "rgba(0, 220, 130, 0.075)" : "rgba(255, 255, 255, 0.025)"};
  cursor: pointer;
  font-size: ${dfstyles.fontSizeS};
  color: ${dfstyles.colors.text};

  &:hover {
    border-color: ${({ $selected }) =>
      $selected ? dfstyles.colors.dfgreen : dfstyles.colors.border};
    background: ${({ $selected }) =>
      $selected ? "rgba(0, 220, 130, 0.12)" : "rgba(255, 255, 255, 0.045)"};
  }
`;

/** Native radio kept for a11y; visually hidden so OS / focus rings don't clash with UI. */
const A11yRadio = styled.input.attrs({ type: "radio" })`
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
`;

const RadioIndicator = styled.span<{ $selected: boolean }>`
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid
    ${({ $selected }) =>
      $selected ? dfstyles.colors.dfgreen : dfstyles.colors.subtext};
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${({ $selected }) =>
    $selected ? "rgba(0, 220, 130, 0.15)" : "transparent"};

  &::after {
    content: "";
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: ${({ $selected }) =>
      $selected ? dfstyles.colors.dfgreen : "transparent"};
  }
`;

const SingleAccountCard = styled.div`
  padding: 10px 12px;
  border: 1px solid ${dfstyles.colors.dfgreen};
  border-radius: ${dfstyles.borderRadius};
  background: rgba(0, 220, 130, 0.075);
  margin-bottom: 12px;
`;

const RowBody = styled.span`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
`;

const RowTitle = styled.span`
  color: ${dfstyles.colors.textLight};
`;

const RowHint = styled.span`
  color: ${dfstyles.colors.subbertext};
  font-size: ${dfstyles.fontSizeXS};
`;

const AddressMono = styled.span`
  display: block;
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: ${dfstyles.colors.subtext};
`;

const TitleBarActions = styled.div`
  margin-left: 8px;
  flex-shrink: 0;
`;

export function QuickJoinSettingsModal({
  open,
  onClose,
  onPreferenceSaved,
}: {
  open: boolean;
  onClose: () => void;
  /** Called after save or clear so parent can refresh derived UI (e.g. account count). */
  onPreferenceSaved?: () => void;
}) {
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [selection, setSelection] = useState<"auto" | string>("auto");

  const reload = useCallback(() => {
    const list = new KeyStore("dfpunk").listAccounts();
    setAccounts(list);
    const saved = getQuickJoinDefaultAccount();
    if (saved && list.some((a) => a.address === saved)) {
      setSelection(saved);
    } else {
      setSelection("auto");
    }
  }, []);

  useEffect(() => {
    if (open) {
      reload();
    }
  }, [open, reload]);

  const chooseSelection = useCallback(
    (value: "auto" | string) => {
      setSelection(value);
      if (value === "auto") {
        clearQuickJoinDefaultAccount();
      } else {
        setQuickJoinDefaultAccount(value);
      }
      onPreferenceSaved?.();
      onClose();
    },
    [onClose, onPreferenceSaved]
  );

  const newest = accounts.reduce<AccountRecord | undefined>(
    (best, a) => (!best || a.createdAt > best.createdAt ? a : best),
    undefined
  );

  const onlyAccount = accounts.length === 1 ? accounts[0] : undefined;

  if (!open) return null;

  return (
    <Modal
      contain={["top", "left", "right"]}
      onMouseDown={(e) => {
        if (
          (e.target as HTMLElement)?.tagName?.toLowerCase() ===
          "darkforest-modal"
        ) {
          onClose();
        }
      }}
    >
      <Title slot="title">Quick join account</Title>
      <TitleBarActions slot="title">
        <Btn
          size="small"
          onClick={(e: Event) => {
            e.stopPropagation();
            onClose();
          }}
        >
          close
        </Btn>
      </TitleBarActions>
      <Content>
        <Intro>
          {onlyAccount ? (
            <>
              You have one local account. Quick join always uses it. Nothing to
              pick between.
            </>
          ) : (
            <>
              Pick the local account Quick join should use. Auto follows your
              newest local account, so newly generated accounts become the
              default.
            </>
          )}
        </Intro>

        {accounts.length === 0 ? (
          <Text style={{ marginBottom: 12, color: dfstyles.colors.subtext }}>
            No local accounts yet. Quick join will create one the first time you
            enter.
          </Text>
        ) : onlyAccount ? (
          <SingleAccountCard>
            <RowTitle as="div" style={{ marginBottom: 6 }}>
              Your account
            </RowTitle>
            <AddressMono title={onlyAccount.address}>
              {shortAddress(onlyAccount.address)}
            </AddressMono>
            {onlyAccount.label ? (
              <RowHint as="div" style={{ marginTop: 6 }}>
                {onlyAccount.label}
              </RowHint>
            ) : null}
          </SingleAccountCard>
        ) : (
          <AccountList>
            <AccountRow
              $selected={selection === "auto"}
              style={{ position: "relative" }}
            >
              <A11yRadio
                name="quickJoinAccount"
                checked={selection === "auto"}
                onChange={() => chooseSelection("auto")}
              />
              <RadioIndicator $selected={selection === "auto"} aria-hidden />
              <RowBody>
                <RowTitle>Auto, newest account</RowTitle>
                {newest ? (
                  <RowHint>
                    Currently{" "}
                    <AddressMono title={newest.address}>
                      {shortAddress(newest.address)}
                    </AddressMono>
                  </RowHint>
                ) : null}
              </RowBody>
            </AccountRow>
            {accounts.map((a) => (
              <AccountRow
                key={a.address}
                $selected={selection === a.address}
                style={{ position: "relative" }}
              >
                <A11yRadio
                  name="quickJoinAccount"
                  checked={selection === a.address}
                  onChange={() => chooseSelection(a.address)}
                />
                <RadioIndicator
                  $selected={selection === a.address}
                  aria-hidden
                />
                <RowBody>
                  <RowTitle>
                    <AddressMono title={a.address}>
                      {shortAddress(a.address)}
                    </AddressMono>
                  </RowTitle>
                  {a.label ? <RowHint>{a.label}</RowHint> : null}
                </RowBody>
              </AccountRow>
            ))}
          </AccountList>
        )}
      </Content>
    </Modal>
  );
}
