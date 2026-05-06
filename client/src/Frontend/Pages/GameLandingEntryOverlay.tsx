import { GAME_NAME } from "@dfpunk/constants";
import React from "react";
import styled, { css } from "styled-components";

import dfstyles from "../Styles/dfstyles";

export type EntryModeChoice = "quick" | "standard" | "terminal";

type Props = {
  onSelect: (mode: EntryModeChoice) => void;
  onConfigureQuickJoin?: () => void;
};

export function GameLandingEntryOverlay({
  onSelect,
  onConfigureQuickJoin,
}: Props) {
  return (
    <Backdrop role="dialog" aria-modal aria-labelledby="entry-overlay-title">
      <Card>
        <Title id="entry-overlay-title">{GAME_NAME}</Title>
        <Subtitle>Choose how you want to sign in</Subtitle>
        <Hint>Pick one. You can refresh the page later to switch.</Hint>
        <ButtonCol>
          <PrimaryRow>
            <BigBtn
              type="button"
              $variant="primary"
              onClick={() => onSelect("quick")}
            >
              Quick join (auto)
            </BigBtn>
            {onConfigureQuickJoin ? (
              <GearBtn
                type="button"
                aria-label="Quick join settings"
                title="Quick join settings"
                onClick={onConfigureQuickJoin}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="3"></circle>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                </svg>
              </GearBtn>
            ) : null}
          </PrimaryRow>
          <Desc>Fastest: auto-selects your default local wallet.</Desc>

          <BigBtn type="button" onClick={() => onSelect("standard")}>
            Standard (buttons + prompts)
          </BigBtn>
          <Desc>
            Guided clicks for wallet choices; terminal still shows status.
          </Desc>

          <BigBtn type="button" onClick={() => onSelect("terminal")}>
            Terminal (advanced)
          </BigBtn>
          <Desc>
            Classic typing flow: type numbers at the prompt and press Enter.
          </Desc>
        </ButtonCol>
      </Card>
    </Backdrop>
  );
}

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(6px);
`;

const Card = styled.div`
  width: min(440px, 100%);
  padding: 28px 24px 32px;
  border-radius: ${dfstyles.borderRadius};
  border: 1px solid ${dfstyles.colors.borderDarkest};
  background: rgba(21, 21, 21, 0.96);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.55);
`;

const Title = styled.h2`
  margin: 0 0 8px;
  font-size: clamp(1.15rem, 3vw, 1.45rem);
  font-weight: 500;
  letter-spacing: 0.06em;
  color: ${dfstyles.colors.textLight};
  text-align: center;
`;

const Subtitle = styled.p`
  margin: 0 0 16px;
  font-size: 0.95rem;
  color: ${dfstyles.colors.subtext};
  text-align: center;
`;

const Hint = styled.p`
  margin: 0 0 22px;
  font-size: 0.82rem;
  color: ${dfstyles.colors.subbertext};
  text-align: center;
  line-height: 1.45;
`;

const ButtonCol = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
`;

const primaryStyles = css`
  justify-content: center;
  text-align: center;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: ${dfstyles.colors.background};
  background: ${dfstyles.colors.dfgreen};
  border-color: ${dfstyles.colors.dfgreen};

  &:hover {
    color: ${dfstyles.colors.background};
    background: ${dfstyles.colors.dfgreenlight};
    border-color: ${dfstyles.colors.dfgreenlight};
  }
`;

const BigBtn = styled.button<{ $variant?: "primary" | "default" }>`
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  height: 48px;
  min-width: calc(19ch + 50px);
  padding: 4px 24px;
  margin: 0;
  font-family: inherit;
  font-size: 16pt;
  line-height: 1;
  text-align: left;
  border-radius: 4px;
  border: 1px solid ${dfstyles.colors.borderDark};
  background: transparent;
  color: ${dfstyles.colors.text};
  cursor: pointer;
  user-select: none;
  box-sizing: border-box;
  transition:
    filter 0.15s,
    background 0.15s,
    color 0.15s,
    border-color 0.15s;

  &:focus-visible {
    outline: 2px solid ${dfstyles.colors.dfgreen};
    outline-offset: 2px;
  }

  &:focus:not(:focus-visible) {
    outline: none;
  }

  &:hover {
    color: ${dfstyles.colors.background};
    background: ${dfstyles.colors.text};
    border-color: ${dfstyles.colors.border};
    filter: brightness(80%);
  }

  ${({ $variant }) => $variant === "primary" && primaryStyles}
`;

const PrimaryRow = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
`;

const GearBtn = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  padding: 0;
  border-radius: 4px;
  border: 1px solid ${dfstyles.colors.borderDark};
  background: transparent;
  color: ${dfstyles.colors.subtext};
  cursor: pointer;
  box-sizing: border-box;
  transition:
    filter 0.15s,
    background 0.15s,
    color 0.15s,
    border-color 0.15s;

  &:focus-visible {
    outline: 2px solid ${dfstyles.colors.dfgreen};
    outline-offset: 2px;
  }

  &:focus:not(:focus-visible) {
    outline: none;
  }

  &:hover {
    color: ${dfstyles.colors.dfgreen};
    border-color: ${dfstyles.colors.dfgreen};
    background: rgba(0, 220, 130, 0.06);
  }
`;

const Desc = styled.p`
  margin: -4px 0 8px;
  padding-left: 2px;
  font-size: 0.78rem;
  line-height: 1.4;
  color: ${dfstyles.colors.subbertext};
`;
