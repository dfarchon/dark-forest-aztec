import { GAME_NAME } from "@dfpunk/constants";
import React from "react";
import styled from "styled-components";

import { Btn } from "../Components/Btn";
import dfstyles from "../Styles/dfstyles";

export type EntryModeChoice = "quick" | "standard" | "terminal";

type Props = {
  onSelect: (mode: EntryModeChoice) => void;
};

export function GameLandingEntryOverlay({ onSelect }: Props) {
  return (
    <Backdrop role="dialog" aria-modal aria-labelledby="entry-overlay-title">
      <Card>
        <Title id="entry-overlay-title">{GAME_NAME}</Title>
        <Subtitle>Choose how you want to sign in</Subtitle>
        <Hint>Pick one. You can refresh the page later to switch.</Hint>
        <ButtonCol>
          <PrimaryWrap>
            <Btn size="large" onClick={() => onSelect("quick")}>
              Quick join
            </Btn>
          </PrimaryWrap>
          <Desc>
            Fastest: creates or resumes a local wallet and keeps going.
          </Desc>

          <Btn size="large" onClick={() => onSelect("standard")}>
            Standard (buttons + prompts)
          </Btn>
          <Desc>
            Guided clicks for wallet choices; terminal still shows status.
          </Desc>

          <Btn size="large" onClick={() => onSelect("terminal")}>
            Terminal (advanced)
          </Btn>
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
  gap: 12px;

  df-button {
    width: 100%;
    justify-content: center;
  }
`;

const PrimaryWrap = styled.div`
  --df-button-color: ${dfstyles.colors.dfgreen};
  --df-button-background: rgba(0, 220, 130, 0.14);
  --df-button-border: 1px solid ${dfstyles.colors.dfgreen};
  --df-button-hover-background: ${dfstyles.colors.dfgreen};
  --df-button-hover-border: 1px solid ${dfstyles.colors.dfgreen};
`;

const Desc = styled.p`
  margin: -4px 0 8px;
  padding-left: 2px;
  font-size: 0.78rem;
  line-height: 1.4;
  color: ${dfstyles.colors.subbertext};
`;
