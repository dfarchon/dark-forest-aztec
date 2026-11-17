import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import styled from "styled-components";

import { Btn } from "../Components/Btn";
import { Slider } from "../Components/Slider";
import { GuidePointer } from "../Panes/BoothGuide/GuidePointer";
import { GuidePointerSequence } from "../Panes/BoothGuide/guidePointerSequence";
import {
  guideControlPoint,
  guidePointerOrigin,
  guideSliderPose,
} from "../Panes/BoothGuide/guidePointerTargets";
import dfstyles from "../Styles/dfstyles";

const LESSONS = [
  {
    label: "Select your home planet",
    hint: "Click the pink planet. The virtual mouse starts at this instruction and shows where to go.",
  },
  {
    label: "Drag the energy slider to 65%",
    hint: "Hold the slider handle and drag it right. Watch the approach, press, drag and release.",
  },
  {
    label: "Press Send",
    hint: "Click Send in the planet panel. This only arms a simulated move.",
  },
  {
    label: "Choose the nearby planet",
    hint: "Click the smaller planet to finish this practice move. No wallet or transaction is involved.",
  },
];

const Page = styled.main`
  min-height: 100vh;
  padding: 32px 24px;
  box-sizing: border-box;
  color: ${dfstyles.colors.text};
  background: ${dfstyles.colors.background};
  font-family: Inconsolata, monospace;
  h1 {
    color: ${dfstyles.colors.dfpink};
    font-size: 26px;
    font-weight: 400;
    margin: 0 0 8px;
  }
  p {
    line-height: 1.45;
  }
  a {
    color: ${dfstyles.colors.dfpink};
  }
`;
const Frame = styled.div`
  max-width: 1280px;
  margin: 0 auto;
`;
const Header = styled.header`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 24px;
  margin-bottom: 24px;
  p {
    margin: 0;
    color: ${dfstyles.colors.subtext};
  }
`;
const Workspace = styled.div`
  display: grid;
  grid-template-columns: 320px minmax(280px, 1fr) 260px;
  gap: 20px;
  align-items: start;
  @media (max-width: 1050px) {
    grid-template-columns: 300px minmax(280px, 1fr);
  }
  @media (max-width: 680px) {
    grid-template-columns: minmax(0, 1fr);
  }
`;
const Panel = styled.aside`
  background: ${dfstyles.colors.backgroundlighter};
  border: 1px solid ${dfstyles.colors.border};
  padding: 12px;
  line-height: 1.45;
  p {
    margin: 0 0 12px;
  }
`;
const Bar = styled.div`
  border-bottom: 1px solid ${dfstyles.colors.border};
  margin: -12px -12px 12px;
  padding: 8px 12px;
  display: flex;
  justify-content: space-between;
  gap: 8px;
  span:last-child {
    color: ${dfstyles.colors.dfgreen};
  }
`;
const Steps = styled.ol`
  list-style: none;
  margin: 0 0 12px;
  padding: 0;
  li {
    padding: 4px 0;
  }
  li[aria-current="step"] {
    color: ${dfstyles.colors.dfgreen};
    font-weight: 600;
  }
`;
const Dock = styled.div`
  border-top: 1px solid ${dfstyles.colors.border};
  padding-top: 12px;
  min-height: 160px;
`;
const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
`;
const Scene = styled.div`
  min-height: 460px;
  position: relative;
  overflow: hidden;
  border: 1px solid ${dfstyles.colors.border};
  background-color: #090a0e;
  background-image:
    radial-gradient(circle at 30% 45%, #f19ac218, transparent 34%),
    radial-gradient(#ffffff42 0.8px, transparent 1px);
  background-size:
    100% 100%,
    37px 43px;
  svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
`;
const SceneLabel = styled.div`
  position: absolute;
  left: 14px;
  top: 12px;
  color: ${dfstyles.colors.subtext};
`;
const Planet = styled.button<{ $home?: boolean; $selected?: boolean }>`
  position: absolute;
  left: ${({ $home }) => ($home ? "30%" : "73%")};
  top: ${({ $home }) => ($home ? "45%" : "64%")};
  width: ${({ $home }) => ($home ? "64px" : "38px")};
  height: ${({ $home }) => ($home ? "64px" : "38px")};
  transform: translate(-50%, -50%);
  border-radius: 50%;
  border: 2px solid ${dfstyles.colors.dfpink};
  background: ${({ $home }) => ($home ? "#c47b9a" : "#7d8aa9")};
  box-shadow:
    0 0 30px #f19ac22a,
    0 0 0 ${({ $selected }) => ($selected ? "8px" : "0")} #f19ac236;
  cursor: pointer;
  &:disabled {
    cursor: default;
  }
  &::after {
    content: attr(data-name);
    position: absolute;
    top: calc(100% + 16px);
    left: 50%;
    transform: translateX(-50%);
    white-space: nowrap;
    color: ${dfstyles.colors.text};
    font:
      14px Inconsolata,
      monospace;
  }
`;
const Resources = styled(Panel)`
  h2 {
    color: ${dfstyles.colors.dfpink};
    font-size: 19px;
    font-weight: 400;
    margin: 0 0 12px;
  }
  .energy {
    display: flex;
    justify-content: space-between;
    margin-bottom: 8px;
  }
  df-slider {
    width: 100%;
    margin-bottom: 16px;
  }
  @media (max-width: 1050px) and (min-width: 681px) {
    grid-column: 2;
  }
`;
const Done = styled.p`
  color: ${dfstyles.colors.dfgreen};
`;

/** A local interaction model. No game manager, wallet or transaction API. */
export function GuidePreviewPage() {
  const panel = useRef<HTMLElement>(null);
  const [pointerSequence] = useState(() => new GuidePointerSequence());
  const [stage, setStage] = useState(0);
  const [energy, setEnergy] = useState(15);
  const [selected, setSelected] = useState(false);
  const [armed, setArmed] = useState(false);
  const [moved, setMoved] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [run, setRun] = useState(0);
  const auto = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const stageRef = useRef(stage);
  stageRef.current = stage;

  useEffect(() => {
    const pauseWhenHidden = () => {
      if (!document.hidden) return;
      auto.current = false;
      setPlaying(false);
      if (timer.current) clearTimeout(timer.current);
      timer.current = undefined;
    };
    document.addEventListener("visibilitychange", pauseWhenHidden);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", pauseWhenHidden);
    };
  }, []);
  const stop = () => {
    auto.current = false;
    setPlaying(false);
    if (timer.current) clearTimeout(timer.current);
    timer.current = undefined;
  };
  const reset = (watch = false) => {
    stop();
    pointerSequence.reset();
    setStage(0);
    setEnergy(15);
    setSelected(false);
    setArmed(false);
    setMoved(false);
    setRun((value) => value + 1);
    auto.current = watch;
    setPlaying(watch);
  };
  const finish = (expected: number) => {
    if (stageRef.current !== expected) return;
    if (expected === 0) setSelected(true);
    if (expected === 2) setArmed(true);
    if (expected === 3) {
      setMoved(true);
      setArmed(false);
      stop();
    }
    setStage(expected + 1);
  };

  const changeEnergy = (event: Event) => {
    stop();
    const value = Number((event.target as HTMLInputElement).value);
    if (!Number.isFinite(value)) return;
    setEnergy(value);
    if (value >= 65) finish(1);
  };

  return (
    <Page>
      <Frame>
        <Header>
          <div>
            <h1>Guide mouse preview</h1>
            <p>
              Practice the cursor movement, clicks and slider drag. No wallet,
              no transactions, no gas.
            </p>
          </div>
          <Link to="/booth">Back to booths</Link>
        </Header>
        <Workspace>
          <Panel ref={panel} data-booth-panel aria-label="Preview lesson">
            <Bar>
              <span>Interaction practice</span>
              <span>Simulation</span>
            </Bar>
            <p>
              The cursor starts at the first instruction, then continues from
              each previous target. Follow it yourself or watch the demo.
            </p>
            <Steps>
              {LESSONS.map((lesson, index) => (
                <li
                  key={lesson.label}
                  data-guide-step={`preview-${index}`}
                  aria-current={stage === index ? "step" : undefined}
                >
                  {index + 1}. {lesson.label}
                </li>
              ))}
            </Steps>
            <Dock data-guide-current-step={stage}>
              {stage < LESSONS.length ? (
                <p>{LESSONS[stage].hint}</p>
              ) : (
                <Done>
                  Practice complete. The move only changed this preview.
                </Done>
              )}
              <Actions>
                <Btn onClick={() => (playing ? stop() : reset(true))}>
                  {playing ? "Stop demo" : "Watch demo"}
                </Btn>
                <Btn onClick={() => reset()}>Reset</Btn>
              </Actions>
            </Dock>
          </Panel>
          <Scene aria-label="Practice map">
            <SceneLabel>
              {moved ? "Simulated move complete" : "Practice universe"}
            </SceneLabel>
            {moved && (
              <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <path
                  d="M30 45 L73 64"
                  stroke={dfstyles.colors.dfpink}
                  strokeWidth="0.5"
                  strokeDasharray="2 1.5"
                  fill="none"
                />
                <circle
                  cx="73"
                  cy="64"
                  r="1.5"
                  fill={dfstyles.colors.dfgreen}
                />
              </svg>
            )}
            <Planet
              $home
              $selected={selected}
              data-name="Home"
              data-booth-target="preview-home"
              aria-label="Select home planet"
              disabled={stage !== 0}
              onClick={() => {
                stop();
                finish(0);
              }}
            />
            <Planet
              data-name="Nearby planet"
              data-booth-target="preview-target"
              aria-label="Choose nearby planet"
              disabled={stage !== 3}
              onClick={() => {
                stop();
                finish(3);
              }}
            />
          </Scene>
          <Resources aria-label="Practice planet controls">
            <h2>{selected ? "Your home planet" : "Select a planet"}</h2>
            <p>Energy available: 100</p>
            <div className="energy">
              <span>Energy to send</span>
              <span aria-live="polite">{energy}%</span>
            </div>
            <Slider
              data-booth-target="preview-energy"
              aria-label="Practice energy percentage"
              variant="filled"
              labelVisibility="none"
              min={0}
              max={100}
              step={1}
              value={energy}
              disabled={stage !== 1}
              onChange={changeEnergy}
              onCommit={changeEnergy}
            />
            <Btn
              data-booth-target="preview-send"
              size="stretch"
              disabled={stage !== 2}
              onClick={() => {
                stop();
                finish(2);
              }}
            >
              {armed ? "Choose a destination" : "Send"}
            </Btn>
            <p style={{ marginTop: 12, color: dfstyles.colors.subtext }}>
              Practice controls only. Nothing is sent to the network.
            </p>
          </Resources>
        </Workspace>
        <GuidePointer
          animationKey={`preview-${run}-${stage}`}
          origin={() =>
            pointerSequence.origin(
              `preview-${run}-${stage}`,
              guidePointerOrigin(panel.current, `preview-${stage}`),
              window.innerWidth,
              window.innerHeight
            )
          }
          onEndpoint={(point) => pointerSequence.remember(point)}
          pose={() => {
            if (stage === 1)
              return guideSliderPose(
                "preview-energy",
                auto.current ? 15 : energy,
                65
              );
            const name =
              stage === 0
                ? "preview-home"
                : stage === 2
                  ? "preview-send"
                  : stage === 3
                    ? "preview-target"
                    : null;
            const at = name ? guideControlPoint(name) : null;
            return at ? { kind: "click", at } : { kind: "hide" };
          }}
          onFrame={(frame) => {
            if (
              auto.current &&
              stage === 1 &&
              frame.dragProgress !== undefined
            ) {
              const value = Math.round(15 + 50 * frame.dragProgress);
              setEnergy((previous) => (previous === value ? previous : value));
            }
          }}
          onComplete={() => {
            if (!auto.current || timer.current || stage >= LESSONS.length)
              return;
            const expected = stage;
            timer.current = setTimeout(() => {
              timer.current = undefined;
              if (auto.current) finish(expected);
            }, 600);
          }}
        />
      </Frame>
    </Page>
  );
}
