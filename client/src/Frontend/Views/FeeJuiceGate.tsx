/**
 * Renders the fee gate (see Session/FeeGate.ts for when each state fires).
 *
 * Two shapes from one event stream:
 *   - the blocking "fuel gauge" modal, when an action was stopped BEFORE
 *     sending because the player has no fee source at all;
 *   - a corner toast, when an action already failed — non-blocking on purpose.
 *
 * Copy rules: the allowance is called "sponsored transactions" (never "free");
 * a stopped action is described truthfully — it was never sent and nothing was
 * spent; and every state offers the bridge, because a wall without a door is
 * just a dead end.
 */
import { resetsIn } from "@alejoamiras/quota-paymaster";
import React, { useEffect, useState } from "react";
import styled from "styled-components";

import { externalLinks } from "../../config/externalLinks";
import {
  dismissFeeGate,
  type FeeGateState,
  subscribeToFeeGate,
} from "../../Session/FeeGate";
import dfstyles from "../Styles/dfstyles";

const BRIDGE_URL = externalLinks.aztecMainnet.feeJuiceBridge;

export function FeeJuiceGate() {
  const [state, setState] = useState<FeeGateState>({ kind: "closed" });

  useEffect(() => subscribeToFeeGate(setState), []);

  if (state.kind === "closed") return <></>;

  if (state.kind === "send-failed") {
    return (
      <Toast role="alert">
        <ToastHead>Move not sent</ToastHead>
        <p>
          No sponsorship and no fee juice were available, so nothing was sent
          and nothing was spent.
        </p>
        <Row>
          <Primary href={BRIDGE_URL} target="_blank" rel="noreferrer">
            Bridge ↗
          </Primary>
          <Ghost as="button" onClick={dismissFeeGate}>
            OK
          </Ghost>
        </Row>
      </Toast>
    );
  }

  const spent = state.kind === "sponsorship-spent";
  return (
    <Dim>
      <Card role="dialog" aria-modal="true" aria-label="Fee juice required">
        <Eyebrow>{spent ? "DAILY SPONSORSHIP" : "FEE JUICE REQUIRED"}</Eyebrow>
        <Title>
          {spent
            ? "You've used today's sponsored transactions"
            : "This action needs fee juice"}
        </Title>
        {spent && (
          <>
            <Gauge aria-label="0 sponsored transactions left">
              {Array.from({ length: state.allowancePerDay }, (_, i) => (
                <Pip key={i} />
              ))}
            </Gauge>
            <GaugeLabel>
              0 of {state.allowancePerDay} sponsored transactions left
            </GaugeLabel>
          </>
        )}
        <Body>
          {spent
            ? "Dark Forest covered your fees so far. From here it's your own " +
              "fee juice — or a short wait. This action was not sent and " +
              "nothing was spent."
            : "Sponsored transactions don't cover this account, and it holds " +
              "no fee juice — so this action was not sent and nothing was " +
              "spent. Bridge $AZTEC into fee juice to play."}
        </Body>
        {spent && (
          <Reset>
            ⏱ sponsored transactions return at {state.resetsAt} — in{" "}
            {resetsIn(state.millisUntilReset)}
          </Reset>
        )}
        <Row $center>
          <Primary href={BRIDGE_URL} target="_blank" rel="noreferrer">
            Bridge fee juice ↗
          </Primary>
          <Ghost as="button" onClick={dismissFeeGate}>
            {spent ? "I'll wait" : "Not now"}
          </Ghost>
        </Row>
      </Card>
    </Dim>
  );
}

const Dim = styled.div`
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: grid;
  place-items: center;
  z-index: 1001;
`;

const Card = styled.div`
  width: min(460px, 92vw);
  background: linear-gradient(180deg, #101613, ${dfstyles.colors.background});
  border: 1px solid ${dfstyles.colors.dfgreendark};
  border-radius: 6px;
  padding: 1.5rem 1.4rem 1.3rem;
  text-align: center;
  box-shadow: 0 12px 44px rgba(0, 0, 0, 0.75);
`;

const Eyebrow = styled.div`
  color: ${dfstyles.colors.dfgreen};
  text-transform: uppercase;
  letter-spacing: 0.18em;
  font-size: 0.72rem;
`;

const Title = styled.div`
  color: ${dfstyles.colors.text};
  font-size: 1.1rem;
  margin: 0.5rem 0;
`;

const Gauge = styled.div`
  display: flex;
  gap: 7px;
  justify-content: center;
  margin: 0.9rem 0 0.3rem;
`;

const Pip = styled.div`
  width: 34px;
  height: 10px;
  border-radius: 2px;
  background: ${dfstyles.colors.dfgreendark};
  border: 1px solid ${dfstyles.colors.dfgreendark};
`;

const GaugeLabel = styled.div`
  font-size: 0.78rem;
  color: ${dfstyles.colors.subtext};
  margin-bottom: 0.9rem;
`;

const Body = styled.p`
  font-size: 0.88rem;
  margin: 0 auto 0.9rem;
  max-width: 42ch;
  color: ${dfstyles.colors.text};
`;

const Reset = styled.div`
  color: ${dfstyles.colors.dfyellow};
  font-size: 0.82rem;
  margin-bottom: 1rem;
`;

const Row = styled.div<{ $center?: boolean }>`
  display: flex;
  gap: 0.7rem;
  justify-content: ${({ $center }) => ($center ? "center" : "flex-start")};
`;

const Primary = styled.a`
  display: inline-block;
  padding: 0.5rem 1.1rem;
  border-radius: 3px;
  background: ${dfstyles.colors.dfgreen};
  border: 1px solid ${dfstyles.colors.dfgreen};
  color: #03130b;
  font-weight: 700;
  text-decoration: none;
  cursor: pointer;
  &:hover {
    filter: brightness(1.1);
  }
`;

const Ghost = styled.a`
  display: inline-block;
  padding: 0.5rem 1.1rem;
  border-radius: 3px;
  background: transparent;
  border: 1px solid ${dfstyles.colors.border};
  color: ${dfstyles.colors.text};
  font-family: inherit;
  font-size: inherit;
  text-decoration: none;
  cursor: pointer;
  &:hover {
    border-color: ${dfstyles.colors.text};
    color: ${dfstyles.colors.dfwhite};
  }
`;

const Toast = styled.div`
  position: absolute;
  right: 1.1rem;
  bottom: 4.5rem; /* clear of CoordsPane */
  width: min(340px, 92vw);
  z-index: 1001;
  background: ${dfstyles.colors.backgrounddark};
  border: 1px solid ${dfstyles.colors.borderDark};
  border-left: 3px solid ${dfstyles.colors.dfred};
  border-radius: 3px;
  padding: 0.75rem 0.9rem;
  font-size: 0.85rem;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6);
  p {
    margin: 0 0 0.55rem;
  }
  ${Primary}, ${Ghost} {
    padding: 0.3rem 0.75rem;
    font-size: 0.8rem;
  }
`;

const ToastHead = styled.div`
  color: ${dfstyles.colors.dfwhite};
  margin-bottom: 0.35rem;
  font-size: 0.9rem;
`;
