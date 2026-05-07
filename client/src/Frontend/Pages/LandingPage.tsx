import { CORE_CONTRACT_ADDRESS } from "@dfpunk/contracts";
import { address } from "@dfpunk/serde";
import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";

import { externalLinks } from "../../config/externalLinks";
import { Btn } from "../Components/Btn";
import { ConnectionSettingsModal } from "../Components/ConnectionSettingsModal";
import { Link, Spacer, Title } from "../Components/CoreUI";
import { Modal } from "../Components/Modal";
import dfstyles from "../Styles/dfstyles";

export const enum LandingPageZIndex {
  Background = 0,
  Canvas = 1,
  BasePage = 2,
  Transition = 3,
}

const defaultAddress = address(CORE_CONTRACT_ADDRESS);

const ButtonWrapper = styled.div`
  display: flex;
  justify-content: center;
  gap: 12px;
  flex-direction: row;

  @media only screen and (max-device-width: 1000px) {
    grid-template-columns: auto;
    flex-direction: column;
  }

  --df-button-color: ${dfstyles.colors.subtext};
  --df-button-border: 1px solid ${dfstyles.colors.borderDark};
  --df-button-hover-background: ${dfstyles.colors.dfgreen};
  --df-button-hover-border: 1px solid ${dfstyles.colors.dfgreen};
`;

const PrimaryAction = styled.div`
  --df-button-color: ${dfstyles.colors.dfgreen};
  --df-button-background: rgba(0, 220, 130, 0.14);
  --df-button-border: 1px solid ${dfstyles.colors.dfgreen};
  --df-button-hover-background: ${dfstyles.colors.dfgreen};
  --df-button-hover-border: 1px solid ${dfstyles.colors.dfgreen};

  df-button {
    min-width: 240px;
  }
`;

const SecondaryAction = styled.div`
  display: inline-block;

  df-button {
    min-width: 160px;
  }
`;

const SettingsModalBoundary = styled.div`
  display: contents;
`;

const MODAL_WIDTH_ESTIMATE = 320;
const MODAL_HEIGHT_ESTIMATE = 420;
const MODAL_GAP_ABOVE_BUTTON = 12;
const ENTER_TRANSITION_DURATION_MS = 1100;

export default function LandingPage() {
  const navigate = useNavigate();
  const [connectionSettingsOpen, setConnectionSettingsOpen] = useState(false);
  const [phase, setPhase] = useState<
    "idle" | "blackhole1" | "disclaimer" | "blackhole2"
  >("idle");
  const [modalAnchor, setModalAnchor] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const networkSettingsRef = useRef<HTMLDivElement>(null);
  const phaseTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (phaseTimeoutRef.current !== null) {
        window.clearTimeout(phaseTimeoutRef.current);
      }
    };
  }, []);

  const enterUniverse = () => {
    if (phase !== "idle") return;
    setPhase("blackhole1");
    phaseTimeoutRef.current = window.setTimeout(() => {
      setPhase("disclaimer");
      phaseTimeoutRef.current = null;
    }, ENTER_TRANSITION_DURATION_MS);
  };

  const acceptDisclaimer = (e: Event) => {
    e.stopPropagation();
    if (phase !== "disclaimer") return;
    setPhase("blackhole2");
    phaseTimeoutRef.current = window.setTimeout(() => {
      navigate(`/play/${defaultAddress}`);
    }, ENTER_TRANSITION_DURATION_MS);
  };

  const toggleConnectionSettings = () => {
    if (!connectionSettingsOpen) {
      const el = networkSettingsRef.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        setModalAnchor({
          x: rect.left + rect.width / 2 - MODAL_WIDTH_ESTIMATE / 2,
          y: rect.top - MODAL_HEIGHT_ESTIMATE - MODAL_GAP_ABOVE_BUTTON,
        });
      }
    }
    setConnectionSettingsOpen((prev) => !prev);
  };

  return (
    <>
      <PrettyOverlayGradient />
      {/* <Hiring /> */}

      <Page onClick={enterUniverse} $entering={phase === "blackhole1"}>
        <OnlyMobile>
          <Spacer height={8} />
        </OnlyMobile>
        <HideOnMobile>
          <Spacer height={150} />
        </HideOnMobile>

        <MainContentContainer>
          <Header>
            <HeroFrame>
              <SignalLine>
                The universe is dark. Your moves are private.
              </SignalLine>
              <HeroTitle>Dark Forest Aztec</HeroTitle>
              <HeroSubtitle>zkSNARK space warfare</HeroSubtitle>
              <HeroBlurb>
                Privacy-first Dark Forest v0.6.5, ported to Aztec.
              </HeroBlurb>
              <Tribute>
                Built in tribute to the original Dark Forest team.
              </Tribute>
            </HeroFrame>

            <Spacer height={32} />

            <ButtonWrapper>
              <PrimaryAction>
                <Btn size="large" onClick={enterUniverse}>
                  Enter Universe
                </Btn>
              </PrimaryAction>
              <SecondaryAction
                ref={networkSettingsRef}
                onClick={(e) => e.stopPropagation()}
              >
                <Btn
                  size="large"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleConnectionSettings();
                  }}
                >
                  Settings
                </Btn>
              </SecondaryAction>
              {/* <Btn size="large" onClick={() => navigate(`/events`)}>
                Events
              </Btn> */}
            </ButtonWrapper>
            <SettingsModalBoundary
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <ConnectionSettingsModal
                open={connectionSettingsOpen}
                onClose={() => setConnectionSettingsOpen(false)}
                anchorPosition={modalAnchor}
              />
            </SettingsModalBoundary>
          </Header>
          {/* <EmSpacer height={3} />
          Ways to get Involved
          <EmSpacer height={1} />
          <Involved>
            <InvolvedItem
              href="https://blog.zkga.me/hosting-a-dark-forest-community-round"
              style={{
                backgroundImage:
                  "url('/get_involved/community_round.png')",
              }}
            ></InvolvedItem>
            <InvolvedItem
              href="https://github.com/darkforest-eth/plugins#adding-your-plugin"
              style={{
                backgroundImage: "url('/get_involved/write_plugin.png')",
              }}
            ></InvolvedItem>
            <InvolvedItem
              href="https://github.com/darkforest-eth/plugins#reviewer-guidelines"
              style={{
                backgroundImage:
                  "url('/get_involved/reveiw_plugin.png')",
              }}
            ></InvolvedItem>
            <InvolvedItem
              href="https://blog.zkga.me/renderer-plugin-contest"
              style={{
                backgroundImage:
                  "url('/get_involved/plugin_render.png')",
              }}
            ></InvolvedItem>
            <InvolvedItem
              href="https://blog.zkga.me/introducing-dark-forest-lobbies"
              style={{
                backgroundImage: "url('/get_involved/lobby.png')",
              }}
            ></InvolvedItem>
          </Involved> */}
          {/* <EmSpacer height={3} /> */}
          {/* <HallOfFame style={{ color: dfstyles.colors.text }}>
            <HallOfFameTitle>Space Masters</HallOfFameTitle>
            <Spacer height={8} />
            <table>
              <tbody>
                <TRow>
                  <td>
                    <HideSmall>v</HideSmall>0.1
                  </td>
                  <td>
                    02/22/<HideSmall>20</HideSmall>20
                  </td>
                  <td>
                    <a href="https://twitter.com/zoink">Dylan Field</a>
                  </td>
                </TRow>
                <TRow>
                  <td>
                    <HideSmall>v</HideSmall>0.2
                  </td>
                  <td>
                    06/24/<HideSmall>20</HideSmall>20
                  </td>
                  <td>Nate Foss</td>
                </TRow>
                <TRow>
                  <td>
                    <Link to="https://blog.zkga.me/v3-rules">
                      <HideSmall>v</HideSmall>0.3
                    </Link>
                  </td>
                  <td>
                    08/07/<HideSmall>20</HideSmall>20
                  </td>
                  <td>
                    <Link to="https://twitter.com/hideandcleanse">
                      @hideandcleanse
                    </Link>
                  </td>
                </TRow>
                <TRow>
                  <td>
                    <Link to="https://blog.zkga.me/v4-recap">
                      <HideSmall>v</HideSmall>0.4
                    </Link>
                  </td>
                  <td>
                    10/02/<HideSmall>20</HideSmall>20
                  </td>
                  <td>
                    <Link to="https://twitter.com/jacobrosenthal">
                      Jacob Rosenthal
                    </Link>
                  </td>
                </TRow>
                <TRow>
                  <td>
                    <Link to="https://blog.zkga.me/v5-winners">
                      <HideSmall>v</HideSmall>0.5
                    </Link>
                  </td>
                  <td>
                    12/25/<HideSmall>20</HideSmall>20
                  </td>
                  <td>0xb05d9542...</td>
                </TRow>
                <TRow>
                  <td>
                    <Link to="https://blog.zkga.me/v6-r1-wrapup">
                      <HideSmall>v</HideSmall>0.6 round 1
                    </Link>
                  </td>
                  <td>
                    05/22/<HideSmall>20</HideSmall>21
                  </td>
                  <td>
                    <Link to="https://twitter.com/adietrichs">
                      Ansgar Dietrichs
                    </Link>
                  </td>
                </TRow>
                <TRow>
                  <td>
                    <Link to="https://blog.zkga.me/v6-r2-wrapup">
                      <HideSmall>v</HideSmall>0.6 round 2
                    </Link>
                  </td>
                  <td>
                    07/07/<HideSmall>20</HideSmall>21
                  </td>
                  <td>
                    <Link to="https://twitter.com/orden_gg">@orden_gg</Link>
                  </td>
                </TRow>
                <TRow>
                  <td>
                    <Link to="https://blog.zkga.me/v6-r3-wrapup">
                      <HideSmall>v</HideSmall>0.6 round 3
                    </Link>
                  </td>
                  <td>
                    08/22/<HideSmall>20</HideSmall>21
                  </td>
                  <td>
                    <Link to="https://twitter.com/dropswap_gg">
                      @dropswap_gg
                    </Link>
                  </td>
                </TRow>
                <TRow>
                  <td>
                    <Link to="https://blog.zkga.me/v6-r4-wrapup">
                      <HideSmall>v</HideSmall>0.6 round 4
                    </Link>
                  </td>
                  <td>
                    10/01/<HideSmall>20</HideSmall>21
                  </td>
                  <td>
                    <Link to="https://twitter.com/orden_gg">@orden_gg</Link>
                  </td>
                </TRow>
                <TRow>
                  <td>
                    <Link to="https://blog.zkga.me/v6-r5-wrapup">
                      <HideSmall>v</HideSmall>0.6 round 5
                    </Link>
                  </td>
                  <td>
                    02/18/<HideSmall>20</HideSmall>22
                  </td>
                  <td>
                    <Link to="https://twitter.com/d_fdao">@d_fdao</Link>
                    {" + "}
                    <Link to="https://twitter.com/orden_gg">@orden_gg</Link>
                  </td>
                </TRow>
              </tbody>
            </table>
          </HallOfFame> */}
          {/* <Spacer height={32} /> */}
        </MainContentContainer>

        {/* <Spacer height={128} />
        <LeadboardDisplay /> 
        <Spacer height={256} /> */}
      </Page>
      {phase !== "idle" && <BlackHoleTransition aria-hidden />}

      {(phase === "disclaimer" || phase === "blackhole2") && (
        <DisclaimerOverlay $leaving={phase === "blackhole2"}>
          <DisclaimerPanel>
            <DisclaimerSignal>Caution: Experimental Protocol</DisclaimerSignal>
            <DisclaimerHeading>Before You Enter</DisclaimerHeading>
            <DisclaimerBody>
              <p>
                Dark Forest Aztec is experimental software built on the Aztec
                Network. By proceeding, you acknowledge:
              </p>
              <DisclaimerList>
                <li>
                  This software is provided &ldquo;as is&rdquo; without warranty
                  of any kind
                </li>
                <li>
                  You may experience bugs, data loss, or unexpected behavior
                </li>
                <li>Blockchain transactions are irreversible once confirmed</li>
                <li>
                  You are solely responsible for your interactions with the
                  protocol
                </li>
                <li>
                  This is not financial advice, do not risk funds you cannot
                  afford to lose
                </li>
              </DisclaimerList>
            </DisclaimerBody>
            <DisclaimerActions>
              <DisclaimerAccept>
                <Btn size="large" onClick={acceptDisclaimer}>
                  Enter Universe
                </Btn>
              </DisclaimerAccept>
              <DisclaimerDecline>
                <Btn
                  size="large"
                  onClick={(e: Event) => {
                    e.stopPropagation();
                    setPhase("idle");
                  }}
                >
                  Decline
                </Btn>
              </DisclaimerDecline>
            </DisclaimerActions>
          </DisclaimerPanel>
        </DisclaimerOverlay>
      )}

      {phase === "blackhole2" && <SecondBlackHoleTransition aria-hidden />}
    </>
  );
}

const PrettyOverlayGradient = styled.div`
  width: 100vw;
  height: 100vh;
  background: ${dfstyles.colors.background};
  background-position: 50%, 50%;
  display: inline-block;
  position: fixed;
  top: 0;
  left: 0;
  z-index: -1;
  overflow: hidden;

  &::before {
    content: "";
    position: absolute;
    inset: 0;
    background-image:
      radial-gradient(${dfstyles.colors.borderDarker} 1px, transparent 1px),
      linear-gradient(${dfstyles.colors.borderDarkest} 1px, transparent 1px),
      linear-gradient(
        90deg,
        ${dfstyles.colors.borderDarkest} 1px,
        transparent 1px
      );
    background-size:
      58px 58px,
      72px 72px,
      72px 72px;
    opacity: 0.18;
  }

  &::after {
    content: "";
    position: absolute;
    inset: 0;
    background:
      linear-gradient(transparent, rgba(0, 0, 0, 0.26)),
      radial-gradient(
        circle at 50% 34%,
        rgba(255, 255, 255, 0.04),
        transparent 38%
      );
  }
`;

const BlackHoleTransition = styled.div`
  position: fixed;
  inset: 0;
  z-index: ${LandingPageZIndex.Transition};
  pointer-events: none;
  overflow: hidden;

  &::before {
    content: "";
    position: absolute;
    top: 50%;
    left: 50%;
    width: 4vmin;
    height: 4vmin;
    border-radius: 50%;
    background: #000;
    transform: translate(-50%, -50%) scale(0);
    animation: black-hole-core ${ENTER_TRANSITION_DURATION_MS}ms forwards;
  }

  @keyframes black-hole-core {
    0% {
      transform: translate(-50%, -50%) scale(0);
      box-shadow: 0 0 0 0 transparent;
    }
    4% {
      transform: translate(-50%, -50%) scale(1);
      box-shadow:
        0 0 0 2px rgba(255, 255, 255, 0.9),
        0 0 60px 20px rgba(0, 220, 130, 0.8),
        0 0 120px 40px rgba(187, 187, 187, 0.3);
    }
    15% {
      box-shadow:
        0 0 0 1px rgba(255, 255, 255, 0.6),
        0 0 40px 10px rgba(0, 220, 130, 0.6),
        0 0 80px 20px rgba(187, 187, 187, 0.2);
    }
    60% {
      transform: translate(-50%, -50%) scale(1.4);
      box-shadow:
        0 0 0 1px rgba(255, 255, 255, 0.4),
        0 0 80px 20px rgba(0, 220, 130, 0.8),
        0 0 160px 40px rgba(187, 187, 187, 0.2);
    }
    100% {
      transform: translate(-50%, -50%) scale(150);
      box-shadow: 0 0 0 0 transparent;
    }
  }
`;

const DISCLAIMER_FADE_IN_MS = 500;

const DisclaimerOverlay = styled.div<{ $leaving?: boolean }>`
  position: fixed;
  inset: 0;
  z-index: ${LandingPageZIndex.Transition + 1};
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${dfstyles.colors.background};
  animation: disclaimer-overlay-in ${DISCLAIMER_FADE_IN_MS}ms ease-out both;

  transition:
    opacity 0.3s ease-out,
    filter 0.3s ease-out,
    transform 0.8s ease-in;
  ${({ $leaving }) =>
    $leaving &&
    `
    opacity: 0;
    filter: blur(12px);
    transform: scale(0.92);
  `}

  @keyframes disclaimer-overlay-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
`;

const DisclaimerPanel = styled.div`
  width: min(700px, calc(100vw - 48px));
  padding: 42px 52px 38px;
  border: 1px solid ${dfstyles.colors.borderDarkest};
  border-radius: ${dfstyles.borderRadius};
  background: rgba(21, 21, 21, 0.88);
  text-align: center;
  animation: disclaimer-panel-in ${DISCLAIMER_FADE_IN_MS + 150}ms ease-out both;

  @keyframes disclaimer-panel-in {
    from {
      opacity: 0;
      transform: scale(0.96) translateY(8px);
    }
    to {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }

  @media only screen and (max-device-width: 1000px) {
    padding: 28px 22px 24px;
  }
`;

const DisclaimerSignal = styled.div`
  margin-bottom: 18px;
  color: ${dfstyles.colors.dfgreen};
  font-size: 0.88em;
  letter-spacing: 0.18em;
  text-transform: uppercase;
`;

const DisclaimerHeading = styled.h2`
  margin: 0 0 24px;
  color: ${dfstyles.colors.textLight};
  font-size: 1.6em;
  font-weight: 400;
  letter-spacing: 0.06em;
`;

const DisclaimerBody = styled.div`
  text-align: left;
  color: ${dfstyles.colors.text};
  font-size: 1.05em;
  line-height: 1.7;
  letter-spacing: 0.02em;

  & > p {
    margin: 0 0 16px;
  }
`;

const DisclaimerList = styled.ul`
  margin: 0;
  padding-left: 22px;
  list-style: none;

  li {
    margin-bottom: 8px;
    color: ${dfstyles.colors.subtext};
    position: relative;
    padding-left: 4px;
  }

  li::before {
    content: "\\203A";
    position: absolute;
    left: -18px;
    color: ${dfstyles.colors.dfgreen};
    opacity: 0.6;
  }
`;

const DisclaimerActions = styled.div`
  margin-top: 32px;
  display: flex;
  justify-content: center;
  gap: 14px;

  @media only screen and (max-device-width: 1000px) {
    flex-direction: column;
    align-items: center;
  }
`;

const DisclaimerAccept = styled.div`
  --df-button-color: ${dfstyles.colors.dfgreen};
  --df-button-background: rgba(0, 220, 130, 0.14);
  --df-button-border: 1px solid ${dfstyles.colors.dfgreen};
  --df-button-hover-background: ${dfstyles.colors.dfgreen};
  --df-button-hover-border: 1px solid ${dfstyles.colors.dfgreen};

  df-button {
    min-width: 320px;
  }
`;

const DisclaimerDecline = styled.div`
  --df-button-color: ${dfstyles.colors.subtext};
  --df-button-border: 1px solid ${dfstyles.colors.borderDark};
  --df-button-hover-background: ${dfstyles.colors.backgroundlighter};
  --df-button-hover-border: 1px solid ${dfstyles.colors.borderDark};

  df-button {
    min-width: 140px;
  }
`;

const SecondBlackHoleTransition = styled(BlackHoleTransition)`
  z-index: ${LandingPageZIndex.Transition + 2};
`;

const Header = styled.div`
  text-align: center;
  padding: 0 24px;
`;

const HeroFrame = styled.div`
  width: min(860px, calc(100vw - 96px));
  max-width: 860px;
  margin: 0 auto;
  padding: 34px 42px 36px;
  border: 1px solid ${dfstyles.colors.borderDarkest};
  border-radius: ${dfstyles.borderRadius};
  background: rgba(21, 21, 21, 0.78);

  @media only screen and (max-device-width: 1000px) {
    width: min(720px, calc(100vw - 32px));
    padding: 28px 22px 30px;
  }
`;

const SignalLine = styled.div`
  margin-bottom: 22px;
  color: ${dfstyles.colors.subbertext};
  font-size: 0.72em;
  letter-spacing: 0.18em;
  text-transform: uppercase;
`;

const HeroTitle = styled.h1`
  margin: 0;
  color: ${dfstyles.colors.textLight};
  font-size: clamp(1.9em, 3.4vw, 2.8em);
  font-weight: 400;
  letter-spacing: 0.06em;
  white-space: nowrap;
`;

const HeroSubtitle = styled.div`
  margin-top: 14px;
  color: ${dfstyles.colors.dfgreen};
  font-size: 1.2em;
  letter-spacing: 0.08em;
`;

const HeroBlurb = styled.p`
  max-width: 640px;
  margin: 30px auto 0;
  color: ${dfstyles.colors.text};
  font-size: 0.95em;
  line-height: 1.55;
  letter-spacing: 0.02em;
`;

const Tribute = styled.p`
  max-width: 640px;
  margin: 10px auto 0;
  color: ${dfstyles.colors.subtext};
  font-size: 0.92em;
  line-height: 1.55;
`;

const EmailWrapper = styled.div`
  display: flex;
  flex-direction: row;
`;

const TRow = styled.tr`
  & td:first-child {
    color: ${dfstyles.colors.subtext};
  }
  & td:nth-child(2) {
    padding-left: 12pt;
  }
  & td:nth-child(3) {
    text-align: right;
    padding-left: 16pt;
  }
`;

const MainContentContainer = styled.div`
  max-width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
`;

const Page = styled.div<{ $entering?: boolean }>`
  position: absolute;
  width: 100vw;
  max-width: 100vw;
  height: 100%;
  color: white;
  font-size: ${dfstyles.fontSize};
  display: flex;
  flex-direction: column;
  align-items: center;
  z-index: ${LandingPageZIndex.BasePage};

  transition:
    opacity 0.3s ease-out,
    filter 0.3s ease-out,
    transform 0.8s ease-in;
  ${({ $entering }) =>
    $entering &&
    `
    opacity: 0;
    filter: blur(12px);
    transform: scale(0.92);
  `}
`;

const HallOfFameTitle = styled.div`
  color: ${dfstyles.colors.subtext};
  display: inline-block;
  border-bottom: 1px solid ${dfstyles.colors.subtext};
  line-height: 1em;
`;

export const LinkContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;

  a {
    margin: 0 6pt;
    transition: color 0.2s;
    display: flex;
    justify-content: center;
    align-items: center;

    &:hover {
      cursor: pointer;
      &.link-twitter {
        color: ${dfstyles.colors.icons.twitter};
      }
      &.link-github {
        color: ${dfstyles.colors.icons.github};
      }
      &.link-discord {
        color: ${dfstyles.colors.icons.discord};
      }
      &.link-blog {
        color: ${dfstyles.colors.icons.blog};
      }
      &.link-email {
        color: ${dfstyles.colors.icons.email};
      }
    }
  }
`;

function Hiring() {
  return (
    <HideOnMobile>
      <Modal contain={["top", "left", "right"]} initialX={50} initialY={50}>
        <Title slot="title">Dark Forest is Hiring!</Title>
        <div style={{ maxWidth: "300px", textAlign: "justify" }}>
          We are looking for experienced full stack and solidity developers to
          join our team! If you like what you see,{" "}
          <Link to={externalLinks.darkForest.hiring.applicantForm}>
            consider applying
          </Link>
          . If you know someone who you think would be a great fit for our team,{" "}
          <Link to={externalLinks.darkForest.hiring.referralForm}>
            please refer them here
          </Link>
          .
          <br />
          <br />
          Learn more about the role{" "}
          <Link to={externalLinks.darkForest.hiring.notion}>here</Link>.
        </div>
      </Modal>
    </HideOnMobile>
  );
}

const HideOnMobile = styled.div`
  @media only screen and (max-device-width: 1000px) {
    display: none;
  }
`;

const OnlyMobile = styled.div`
  @media only screen and (min-device-width: 1000px) {
    display: none;
  }
`;

const Involved = styled.div`
  width: 100%;
  padding-left: 16px;
  padding-right: 16px;
  display: grid;
  grid-template-columns: auto auto;
  gap: 10px;
  grid-auto-rows: minmax(100px, auto);

  @media only screen and (max-device-width: 1000px) {
    grid-template-columns: auto;
  }
`;

const InvolvedItem = styled.a`
  height: 150px;
  display: inline-block;
  margin: 4px;
  padding: 4px 8px;

  background-color: ${dfstyles.colors.backgroundlighter};
  background-size: cover;
  background-position: 50% 50%;
  background-repeat: no-repeat;

  cursor: pointer;
  transition: transform 200ms;
  &:hover {
    transform: scale(1.03);
  }
  &:hover:active {
    transform: scale(1.05);
  }
`;

const HallOfFame = styled.div`
  @media only screen and (max-device-width: 1000px) {
    font-size: 70%;
  }
`;
