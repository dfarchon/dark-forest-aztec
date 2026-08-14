import { L2_TOKEN_SYMBOL } from "@dfpunk/constants";
import { Monomitter } from "@dfpunk/events";
import { EthAddress, ModalName, TooltipName } from "@dfpunk/types";
import React, { useEffect, useState } from "react";
import styled from "styled-components";

import { Hook } from "../../_types/global/GlobalTypes";
// import { CaptureZonesGeneratedEvent } from "../../Backend/GameLogic/CaptureZoneGenerator";
import { weiToEth } from "../../Backend/Utils/Utils";
import {
  formatQuotaBadge,
  formatQuotaTooltip,
  QUOTA_STATUS_OFF,
  type QuotaStatus,
  subscribeToQuotaStatus,
} from "../../Session/QuotaStatus";

// Stub type for when CaptureZoneGenerator is re-enabled
type CaptureZonesGeneratedEvent = { nextChangeBlock: number };
import { AlignCenterHorizontally } from "../Components/CoreUI";
import { AccountLabel } from "../Components/Labels/Labels";
import { Gold, Red, Sub, Text, White } from "../Components/Text";
import { TooltipTrigger } from "../Panes/Tooltip";
import { usePlayer, useUIManager } from "../Utils/AppHooks";
import { DFZIndex } from "../Utils/constants";
import { useEmitterSubscribe, useEmitterValue } from "../Utils/EmitterHooks";
import { ModalToggleButton } from "./ModalIcon";
import { NetworkHealth } from "./NetworkHealth";
import { Paused } from "./Paused";

const TopBarContainer = styled.div`
  z-index: ${DFZIndex.MenuBar};
  padding: 0 2px;
  width: 530px;
`;

const Numbers = styled.div`
  display: inline-block;
`;

function BoardPlacement({ account }: { account: EthAddress | undefined }) {
  const uiManager = useUIManager();
  const player = usePlayer(uiManager, account);

  let content;

  if (!player.value) {
    content = <Sub>n/a</Sub>;
  } else {
    let formattedScore = "n/a";
    if (player.value.score !== undefined && player.value.score !== null) {
      formattedScore = player.value.score.toLocaleString();
    }

    content = (
      <Sub>
        <TooltipTrigger name={TooltipName.Score}>
          score: <Text>{formattedScore}</Text>
        </TooltipTrigger>
      </Sub>
    );
  }

  return <Numbers>{content}</Numbers>;
}

function SpaceJunk({ account }: { account: EthAddress | undefined }) {
  const uiManager = useUIManager();

  const [spaceJunk, setSpaceJunk] = useState<number>(0);
  const [spaceJunkLimit, setSpaceJunkLimit] = useState<number>(0);

  useEffect(() => {
    if (!uiManager) return;
    const gameManager = uiManager.getGameManager();

    const refreshSpaceJunk = () => {
      if (!account) return;

      setSpaceJunk(gameManager.getPlayerSpaceJunk(account) || 0);
      setSpaceJunkLimit(gameManager.getPlayerSpaceJunkLimit(account) || 0);
    };

    const sub = gameManager.playersUpdated$.subscribe(() => {
      refreshSpaceJunk();
    });
    refreshSpaceJunk();

    return () => sub.unsubscribe();
  }, [uiManager, account]);

  return (
    <Numbers>
      <Sub>
        <TooltipTrigger name={TooltipName.SpaceJunk}>
          space junk:{" "}
          <Text>
            {spaceJunk} / {spaceJunkLimit}
          </Text>
        </TooltipTrigger>
      </Sub>
    </Numbers>
  );
}

function CaptureZoneExplanation() {
  const uiManager = useUIManager();

  const numberedItem = (n: number, content: string) => (
    <li>
      <White>{n}.)</White> {content}
    </li>
  );

  return (
    <>
      <White>Capture Zones:</White> Energy fluctations are creating highly
      valuable zones of space.{" "}
      <Gold>
        Invading and holding planets in these areas give you score! The zones
        are marked as gold rings on your map.
      </Gold>
      <br />
      <br />
      In order to capture a planet in a zone, you must:
      <ol>
        {numberedItem(1, "Own a planet in the capture zone.")}
        {numberedItem(2, "Start the invasion by clicking the Invade button.")}
        {numberedItem(
          3,
          `Hold the planet for ${uiManager.contractConstants.CAPTURE_ZONE_HOLD_BLOCKS_REQUIRED}
          blocks.`
        )}
        {numberedItem(
          4,
          "Capture the planet by clicking the Capture button (Capturing does not require you to be in the zone, only Invading)."
        )}
      </ol>
      <br />
      <Red>
        Planets can only be Captured once. However, after an Invasion has
        started, anyone can capture it.
      </Red>{" "}
      If you see an opponent start their Invasion, you can take the planet from
      them and Capture it for yourself!
    </>
  );
}

function CaptureZones({
  emitter,
  nextChangeBlock,
}: {
  emitter: Monomitter<CaptureZonesGeneratedEvent>;
  nextChangeBlock: number;
}) {
  const uiManager = useUIManager();
  const currentBlockNumber = useEmitterValue(
    uiManager.getEthConnection().blockNumber$,
    undefined
  );
  const [nextGenerationBlock, setNextGenerationBlock] = useState(
    Math.max(
      uiManager.contractConstants.GAME_START_BLOCK +
        uiManager.contractConstants.CAPTURE_ZONE_CHANGE_BLOCK_INTERVAL,
      nextChangeBlock
    )
  );

  useEmitterSubscribe(
    emitter,
    (zoneGeneration) => {
      setNextGenerationBlock(zoneGeneration.nextChangeBlock);
    },
    [setNextGenerationBlock]
  );

  return (
    <Numbers>
      <TooltipTrigger
        name={TooltipName.Empty}
        extraContent={<CaptureZoneExplanation />}
      >
        Capture Zones change in{" "}
        {nextGenerationBlock - (currentBlockNumber || 0)} blocks.
      </TooltipTrigger>
    </Numbers>
  );
}

export function TopBar({
  twitterVerifyHook,
}: {
  twitterVerifyHook: Hook<boolean>;
}) {
  const uiManager = useUIManager();
  const isExternalWallet = uiManager.getGameManager().isExternalWallet();
  const player = usePlayer(uiManager);
  const account = player.value?.address;
  const twitter = player.value?.twitter;
  const balance = useEmitterValue(
    uiManager.getMyBalance$(),
    uiManager.getMyBalanceBn()
  );

  // TODO: CaptureZoneGenerator module and getCaptureZoneGenerator not yet implemented
  // let captureZones = null;
  // if (uiManager.captureZonesEnabled) {
  //   const captureZoneGenerator = uiManager.getCaptureZoneGenerator();
  //   if (captureZoneGenerator) {
  //     const emitter = captureZoneGenerator.generated$;
  //     const nextChangeBlock = captureZoneGenerator.getNextChangeBlock();
  //     captureZones = (
  //       <CaptureZones emitter={emitter} nextChangeBlock={nextChangeBlock} />
  //     );
  //   }
  // }
  const captureZones = null;

  return (
    <TopBarContainer>
      <AlignCenterHorizontally
        style={{ width: "100%", justifyContent: "space-around" }}
      >
        <TooltipTrigger
          name={TooltipName.Empty}
          extraContent={<Text>Your wallet address.</Text>}
        >
          <AccountLabel includeAddressIfHasTwitter={true} width={"50px"} />
        </TooltipTrigger>
        <TooltipTrigger
          name={TooltipName.Empty}
          extraContent={<Text>Your current wallet balance.</Text>}
        >
          <Sub>
            ({weiToEth(balance ?? 0n).toFixed(2)} {L2_TOKEN_SYMBOL})
          </Sub>
        </TooltipTrigger>
        <QuotaBadge />
        {process.env.DF_WEBSERVER_URL && (
          <>
            <TooltipTrigger
              name={TooltipName.Empty}
              extraContent={
                <Text>
                  Connect your {isExternalWallet ? "wallet" : "local wallet"} to
                  your twitter account.
                </Text>
              }
            >
              <ModalToggleButton
                size="small"
                modal={ModalName.TwitterVerify}
                hook={twitterVerifyHook}
                style={
                  {
                    width: !twitter ? "100px" : undefined,
                  } as CSSStyleDeclaration & React.CSSProperties
                }
                text={!twitter ? "Connect" : undefined}
              />
            </TooltipTrigger>
          </>
        )}
        <BoardPlacement account={account} />
      </AlignCenterHorizontally>
      <AlignCenterHorizontally
        style={{ justifyContent: "space-around", width: "100%" }}
      >
        {captureZones}
        {uiManager.getSpaceJunkEnabled() && (
          <>
            <SpaceJunk account={account} />
          </>
        )}
      </AlignCenterHorizontally>
      <NetworkHealth />
      <Paused />
    </TopBarContainer>
  );
}

/**
 * Shows how many transactions Dark Forest is paying for today. Renders nothing
 * when sponsorship is not enabled, so builds without a paymaster look exactly
 * as they always have.
 */
function QuotaBadge() {
  const [status, setStatus] = useState<QuotaStatus>(QUOTA_STATUS_OFF);
  const uiManager = useUIManager();

  // The transaction path publishes allowance state as it reads it, so the badge
  // reflects what the last transaction actually saw rather than polling.
  useEffect(() => subscribeToQuotaStatus(setStatus), []);

  // One read on load (so sponsorship is visible BEFORE the first transaction),
  // then one more just after each UTC rollover — a tab left open overnight
  // would otherwise keep showing yesterday's spent allowance until the next
  // send. The timer re-arms off whatever state each refresh publishes, so it
  // follows CHAIN time (millisUntilReset is computed from the block timestamp,
  // not the local clock, which can disagree by hours on some networks).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const refresh = () => {
      try {
        void uiManager
          .getGameManager()
          .getContractAPI()
          .getWalletManager()
          .refreshQuotaStatus();
      } catch {
        /* advisory only; the send path will publish regardless */
      }
    };

    // Re-arm from published state rather than scheduling ahead of time: every
    // publisher (this refresh, and every transaction) carries a fresh
    // millisUntilReset, so the timer self-corrects instead of drifting.
    const unsubscribe = subscribeToQuotaStatus((status) => {
      if (cancelled) return;
      clearTimeout(timer);
      if (status.kind === "off" || status.millisUntilReset <= 0) return;
      // +5s past the boundary so the on-chain generation has actually rolled
      // by the time we read; clamp below so a stale near-zero value cannot
      // spin-loop refreshes.
      const delay = Math.max(status.millisUntilReset + 5_000, 30_000);
      timer = setTimeout(refresh, delay);
    });

    refresh();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      unsubscribe();
    };
  }, [uiManager]);

  const label = formatQuotaBadge(status);
  if (!label) return null;

  return (
    <TooltipTrigger
      name={TooltipName.Empty}
      extraContent={<Text>{formatQuotaTooltip(status)}</Text>}
    >
      <Sub>
        {status.kind === "spent" ? <Red>{label}</Red> : <Gold>{label}</Gold>}
      </Sub>
    </TooltipTrigger>
  );
}
