import { CORE_CONTRACT_ADDRESS } from "@dfpunk/contracts";
import { address } from "@dfpunk/serde";
import React, { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import GameManager from "../../Backend/GameLogic/GameManager";
import TutorialManager, {
  TutorialState,
} from "../../Backend/GameLogic/TutorialManager";
import { getSponsorMode } from "../../config/env";
import {
  GameWindowWrapper,
  InitRenderState,
  TerminalToggler,
  TerminalWrapper,
  Wrapper,
} from "../Components/GameLandingPageComponents";
import { BlockSyncStatus } from "../Components/GameLandingPageStatus";
import { TopLevelDivProvider, UIManagerProvider } from "../Utils/AppHooks";
import { TerminalPromptStep } from "../Utils/GameLandingPageShared";
import UIEmitter, { UIEmitterEvent } from "../Utils/UIEmitter";
import { useGameLandingFlow } from "../Utils/useGameLandingFlow";
import { useGameLandingSession } from "../Utils/useGameLandingSession";
import { GameWindowLayout } from "../Views/GameWindowLayout";
import { Terminal, TerminalHandle } from "../Views/Terminal";

export function GameLandingPage() {
  const { contract } = useParams<{ contract: string }>();
  const terminalHandle = useRef<TerminalHandle | undefined>(undefined);
  const topLevelContainer = useRef<HTMLDivElement | null>(null);

  const [gameManager, setGameManager] = useState<GameManager | undefined>();
  const [terminalVisible, setTerminalVisible] = useState(true);
  const [initRenderState, setInitRenderState] = useState(InitRenderState.NONE);
  const [step, setStep] = useState(TerminalPromptStep.NONE);

  const contractAddress = contract
    ? address(contract)
    : address(CORE_CONTRACT_ADDRESS);
  const isLobby = contractAddress !== address(CORE_CONTRACT_ADDRESS);
  const sponsorMode = getSponsorMode();

  const session = useGameLandingSession({
    sponsorMode,
    terminalHandle,
    setGameManager,
    setStep,
    setTerminalVisible,
  });

  const { advanceState } = useGameLandingFlow({
    contractAddress,
    isLobby,
    setGameManager,
    setInitRenderState,
    setStep,
    sponsorMode,
    step,
    session,
  });
  const advanceStateRef = useRef(advanceState);

  useEffect(() => {
    const uiEmitter = UIEmitter.getInstance();
    uiEmitter.emit(UIEmitterEvent.UIChange);
  }, [initRenderState]);

  useEffect(() => {
    advanceStateRef.current = advanceState;
  }, [advanceState]);

  useEffect(() => {
    const gameUiManager = session.gameUIManagerRef.current;
    if (!terminalVisible && gameUiManager) {
      const tutorialManager = TutorialManager.getInstance(gameUiManager);
      tutorialManager.acceptInput(TutorialState.Terminal);
    }
  }, [session.gameUIManagerRef, terminalVisible]);

  useEffect(() => {
    if (terminalHandle.current && topLevelContainer.current) {
      void advanceStateRef.current(terminalHandle);
    }
  }, [step]);

  return (
    <Wrapper initRender={initRenderState} terminalEnabled={terminalVisible}>
      <GameWindowWrapper
        initRender={initRenderState}
        terminalEnabled={terminalVisible}
      >
        {session.gameUIManagerRef.current &&
          topLevelContainer.current &&
          gameManager && (
            <TopLevelDivProvider value={topLevelContainer.current}>
              <UIManagerProvider value={session.gameUIManagerRef.current}>
                <GameWindowLayout
                  terminalVisible={terminalVisible}
                  setTerminalVisible={setTerminalVisible}
                />
              </UIManagerProvider>
            </TopLevelDivProvider>
          )}
      </GameWindowWrapper>
      <TerminalToggler
        terminalEnabled={terminalVisible}
        setTerminalEnabled={setTerminalVisible}
        initRender={initRenderState}
      />
      <TerminalWrapper
        initRender={initRenderState}
        terminalEnabled={terminalVisible}
      >
        <Terminal
          ref={terminalHandle as React.Ref<TerminalHandle>}
          promptCharacter={"$"}
        />
        {initRenderState === InitRenderState.COMPLETE &&
          session.indexerRef.current && (
            <BlockSyncStatus connection={session.indexerRef.current} />
          )}
      </TerminalWrapper>
      <div ref={topLevelContainer}></div>
    </Wrapper>
  );
}
