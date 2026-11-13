import { L2_TOKEN_SYMBOL } from "@dfpunk/constants";
import { Monomitter } from "@dfpunk/events";
import { EthAddress, ModalName, TooltipName } from "@dfpunk/types";
import React, { useEffect, useRef, useState } from "react";
import styled from "styled-components";

import { Hook } from "../../_types/global/GlobalTypes";
// import { CaptureZonesGeneratedEvent } from "../../Backend/GameLogic/CaptureZoneGenerator";
import { weiToEth } from "../../Backend/Utils/Utils";

// Stub type for when CaptureZoneGenerator is re-enabled
type CaptureZonesGeneratedEvent = { nextChangeBlock: number };
import { TextInput } from "../Components/Input";
import { Gold, Red, Sub, Text, White } from "../Components/Text";
import { TooltipTrigger } from "../Panes/Tooltip";
import dfstyles from "../Styles/dfstyles";
import { usePlayer, useUIManager } from "../Utils/AppHooks";
import { DFZIndex } from "../Utils/constants";
import { useEmitterSubscribe, useEmitterValue } from "../Utils/EmitterHooks";
import { ModalToggleButton } from "./ModalIcon";
import { NetworkHealth } from "./NetworkHealth";
import { Paused } from "./Paused";

const TopBarContainer = styled.div`
  z-index: ${DFZIndex.MenuBar};
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: max-content;
  color: ${dfstyles.colors.text};
`;

const PlateRow = styled.div`
  display: flex;
  flex-direction: row;
  align-items: baseline;
  gap: 6px;
`;

const AddressLine = styled(PlateRow)`
  height: 26px;
  align-items: center;
  color: inherit;
`;

const AddressSlot = styled.div`
  width: 11em;
  height: 26px;
  display: flex;
  align-items: center;

  df-text-input {
    display: block;
    width: 100%;
    height: 26px;
  }
`;

const AddressLabel = styled.span`
  display: block;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 26px;
  cursor: zoom-in;
`;

function AccountAddress() {
  const uiManager = useUIManager();
  const account = uiManager.getAccount() || "<no account>";
  const [open, setOpen] = useState(false);

  return (
    <AddressSlot>
      {open ? (
        <TextInput
          selected={true}
          readonly={true}
          value={account}
          onBlur={() => setOpen(false)}
        />
      ) : (
        <AddressLabel
          onClick={(event) => {
            event.stopPropagation();
            setOpen(true);
          }}
        >
          {account}
        </AddressLabel>
      )}
    </AddressSlot>
  );
}

const BlockLine = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: inherit;
`;

const BlockDot = styled.span<{ $flash: boolean }>`
  width: 6px;
  height: 6px;
  flex: 0 0 6px;
  border-radius: 50%;
  background: ${dfstyles.colors.dfgreen};
  animation: ${({ $flash }) =>
    $flash ? "block-dot-flash 700ms ease-out 1" : "none"};

  @keyframes block-dot-flash {
    0% {
      opacity: 1;
      transform: scale(1);
    }
    35% {
      opacity: 0.15;
      transform: scale(1.8);
      box-shadow: 0 0 8px 2px ${dfstyles.colors.dfgreen};
    }
    100% {
      opacity: 1;
      transform: scale(1);
      box-shadow: none;
    }
  }
`;

function BlockReadout() {
  const uiManager = useUIManager();
  const blockNumber = useEmitterValue(
    uiManager.getEthConnection().blockNumber$,
    undefined
  );
  const previousBlock = useRef<number | undefined>(undefined);
  const [flashKey, setFlashKey] = useState(0);

  useEffect(() => {
    if (blockNumber === undefined) return;
    if (
      previousBlock.current !== undefined &&
      previousBlock.current !== blockNumber
    ) {
      setFlashKey((key) => key + 1);
    }
    previousBlock.current = blockNumber;
  }, [blockNumber]);

  return (
    <BlockLine>
      <BlockDot key={flashKey} $flash={flashKey > 0} />
      block {blockNumber ?? "…"}
    </BlockLine>
  );
}

const Numbers = styled.div`
  display: inline-block;
`;

function BoardPlacement({ account }: { account: EthAddress | undefined }) {
  const uiManager = useUIManager();
  const player = usePlayer(uiManager, account);

  let content;

  if (!player.value) {
    content = <>n/a</>;
  } else {
    let formattedScore = "n/a";
    if (player.value.score !== undefined && player.value.score !== null) {
      formattedScore = player.value.score.toLocaleString();
    }

    content = (
      <TooltipTrigger name={TooltipName.Score}>
        score {formattedScore}
      </TooltipTrigger>
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
      <AddressLine>
        <TooltipTrigger
          name={TooltipName.Empty}
          extraContent={<Text>Click to show your wallet address.</Text>}
          style={{ display: "flex", height: "26px", alignItems: "center" }}
        >
          <AccountAddress />
        </TooltipTrigger>
      </AddressLine>
      <PlateRow>
        <TooltipTrigger
          name={TooltipName.Empty}
          extraContent={<Text>Your current wallet balance.</Text>}
        >
          <>
            {weiToEth(balance ?? 0n).toFixed(2)} {L2_TOKEN_SYMBOL}
          </>
        </TooltipTrigger>
      </PlateRow>
      <PlateRow>
        <BoardPlacement account={account} />
      </PlateRow>
      <PlateRow>
        <BlockReadout />
      </PlateRow>
      {process.env.DF_WEBSERVER_URL && (
        <PlateRow>
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
        </PlateRow>
      )}
      {captureZones}
      {uiManager.getSpaceJunkEnabled() && <SpaceJunk account={account} />}
      <NetworkHealth />
      <Paused />
    </TopBarContainer>
  );
}
