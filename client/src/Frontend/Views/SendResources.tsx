import { formatNumber, isSpaceShip } from "@dfpunk/gamelogic";
import { isUnconfirmedMoveTx, isUnconfirmedReleaseTx } from "@dfpunk/serde";
import {
  Artifact,
  artifactNameFromArtifact,
  Planet,
  Setting,
  TooltipName,
} from "@dfpunk/types";
import React, { useCallback } from "react";
import styled from "styled-components";

import { StatIdx } from "../../_types/global/GlobalTypes";
import { Wrapper } from "../../Backend/Utils/Wrapper";
import { Btn } from "../Components/Btn";
import { Icon, IconType } from "../Components/Icons";
import { LoadingSpinner } from "../Components/LoadingSpinner";
import { MaybeShortcutButton } from "../Components/MaybeShortcutButton";
import { Row } from "../Components/Row";
import { Slider } from "../Components/Slider";
import { LongDash, Subber } from "../Components/Text";
import { TooltipTrigger } from "../Panes/Tooltip";
import dfstyles from "../Styles/dfstyles";
import {
  useAccount,
  usePlanetInactiveArtifacts,
  useUIManager,
} from "../Utils/AppHooks";
import { useEmitterValue } from "../Utils/EmitterHooks";
import { useBooleanSetting } from "../Utils/SettingsHooks";
import { TOGGLE_ABANDON, TOGGLE_SEND } from "../Utils/ShortcutConstants";
import { useShortcut } from "../Utils/useShortcut";
import { SelectArtifactRow } from "./ArtifactRow";

const ENERGY_PERCENT_KEYS = "1234567890".split("");
const SILVER_PERCENT_KEYS = "!@#$%^&*()".split("");
const SEND_RESOURCE_SHORTCUTS = [
  ...ENERGY_PERCENT_KEYS,
  ...SILVER_PERCENT_KEYS,
  "-",
  "=",
  "_",
  "+",
];

const StyledSendResources = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const StyledShowPercent = styled.div`
  display: inline-block;

  & > span:first-child {
    width: 3em;
    text-align: right;
    margin-right: 1em;
  }

  & > span:last-child {
    color: ${dfstyles.colors.subtext};
    & > span {
      ${dfstyles.prefabs.noselect};
      &:hover {
        color: ${dfstyles.colors.text};
        cursor: pointer;
      }
      &:first-child {
        margin-right: 0.5em;
      }
    }
  }
`;
function ShowPercent({
  value,
  setValue,
}: {
  value: number;
  setValue: (x: number) => void;
}) {
  return (
    <StyledShowPercent>
      <span>{value}%</span>
      <span>
        <span onClick={() => setValue(value - 1)}>
          <LongDash />
        </span>
        <span onClick={() => setValue(value + 1)}>+</span>
      </span>
    </StyledShowPercent>
  );
}

const ResourceRowDetails = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 4px;
`;

function ResourceBar({
  isSilver,
  selected,
  value,
  setValue,
  disabled,
}: {
  isSilver?: boolean;
  selected: Planet | undefined;
  value: number;
  setValue: (x: number) => void;
  disabled?: boolean;
}) {
  const getResource = useCallback(
    (val: number) => {
      if (!selected) return "";
      const resource = isSilver ? selected.silver : selected.energy;
      return formatNumber((val / 100) * resource);
    },
    [selected, isSilver]
  );

  return (
    <>
      <Row>
        <ResourceRowDetails>
          <Icon type={isSilver ? IconType.Silver : IconType.Energy} />
          {getResource(value)}
          <Subber>{isSilver ? "silver" : "energy"}</Subber>
        </ResourceRowDetails>
        <ShowPercent value={value} setValue={setValue} />
      </Row>
      <Slider
        variant="filled"
        labelVisibility="none"
        min={0}
        max={100}
        value={value}
        step={1}
        disabled={disabled}
        onChange={(e: Event) => {
          setValue(parseInt((e.target as HTMLInputElement).value, 10));
        }}
      />
    </>
  );
}

function AbandonButton({
  planet,
  abandoning,
  toggleAbandoning,
  disabled,
}: {
  planet?: Planet;
  abandoning: boolean;
  toggleAbandoning: () => void;
  disabled?: boolean;
}) {
  const uiManager = useUIManager();

  if (!planet) return null;

  let junk = uiManager.getDefaultSpaceJunkForPlanetLevel(planet?.planetLevel);
  if (planet.bonus[StatIdx.SpaceJunk]) junk /= 2;
  /* Explicitly avoid binding to `onShortcutPressed` so we can support sending on subpanes */
  return (
    <MaybeShortcutButton
      size="stretch"
      active={abandoning}
      onClick={toggleAbandoning}
      shortcutKey={TOGGLE_ABANDON}
      shortcutText={TOGGLE_ABANDON}
      disabled={planet.isHomePlanet || disabled}
    >
      <TooltipTrigger name={TooltipName.Abandon}>
        {abandoning ? "Abandoning" : `Abandon Planet (-${junk}) space junk`}
      </TooltipTrigger>
    </MaybeShortcutButton>
  );
}

function SendRow({
  toggleSending,
  artifact,
  sending,
  abandoning,
  disabled = false,
}: {
  toggleSending: () => void;
  artifact: Artifact | undefined;
  sending: boolean;
  abandoning?: boolean;
  disabled?: boolean;
}) {
  let content = "Send";
  if (artifact) {
    const artifactName = artifactNameFromArtifact(artifact);
    if (isSpaceShip(artifact.artifactType)) {
      // Call it "Move" with a spaceship, instead of "Send"
      content = `Move ${artifactName}`;
    } else {
      // Only add the "+" if we are sending Energy & Artifact
      content += ` + ${artifactName}`;
    }
  }
  if (abandoning) {
    content += " and Abandon";
  }
  /* Explicitly avoid binding to `onShortcutPressed` so we can support sending on subpanes */
  return (
    <MaybeShortcutButton
      size="stretch"
      onClick={toggleSending}
      active={sending}
      shortcutKey={TOGGLE_SEND}
      shortcutText={TOGGLE_SEND}
      disabled={disabled}
    >
      {content}
    </MaybeShortcutButton>
  );
}

export function SendResources({
  planetWrapper: p,
  onToggleSendForces,
  onToggleAbandon,
}: {
  planetWrapper: Wrapper<Planet | undefined>;
  onToggleSendForces: () => void;
  onToggleAbandon: () => void;
}) {
  const uiManager = useUIManager();
  const account = useAccount(uiManager);
  const owned = p.value?.owner === account;
  const locationId = p?.value?.locationId;

  const isSendingShip = uiManager.isSendingShip(locationId);

  const isAbandoning = useEmitterValue(uiManager.isAbandoning$, false);
  const isSendingForces = useEmitterValue(uiManager.isSending$, false);
  const energySending = uiManager.getForcesSending(locationId);
  const silverSending = uiManager.getSilverSending(locationId);
  const artifactSending = uiManager.getArtifactSending(locationId);

  const disableSliders = isSendingShip || isAbandoning;

  const updateEnergySending = useCallback(
    (energyPercent: number) => {
      if (!locationId) return;
      uiManager.setForcesSending(locationId, energyPercent);
    },
    [uiManager, locationId]
  );

  const updateSilverSending = useCallback(
    (silverPercent: number) => {
      if (!locationId) return;
      uiManager.setSilverSending(locationId, silverPercent);
    },
    [uiManager, locationId]
  );

  const updateArtifactSending = useCallback(
    (artifact: Artifact | undefined) => {
      if (!locationId) return;
      uiManager.setArtifactSending(locationId, artifact);
    },
    [uiManager, locationId]
  );

  const [disableDefaultShortcuts] = useBooleanSetting(
    uiManager,
    Setting.DisableDefaultShortcuts
  );

  // 1-0 set energy to 10%-100%. Shifted digits set silver the same way.
  // -/= nudge energy, _/+ nudge silver.
  useShortcut(
    SEND_RESOURCE_SHORTCUTS,
    (key) => {
      const energyIndex = ENERGY_PERCENT_KEYS.indexOf(key);
      if (energyIndex >= 0) {
        updateEnergySending((energyIndex + 1) * 10);
        return;
      }
      const silverIndex = SILVER_PERCENT_KEYS.indexOf(key);
      if (silverIndex >= 0) {
        updateSilverSending((silverIndex + 1) * 10);
        return;
      }
      if (key === "-" || key === "=") {
        const current = uiManager.getForcesSending(locationId);
        updateEnergySending(current + (key === "=" ? 10 : -10));
        return;
      }
      if (key === "_" || key === "+") {
        const current = uiManager.getSilverSending(locationId);
        updateSilverSending(current + (key === "+" ? 10 : -10));
      }
    },
    { enabled: !disableDefaultShortcuts }
  );

  const artifacts = usePlanetInactiveArtifacts(p, uiManager);
  const spaceshipsYouOwn = artifacts.filter(
    (a) => isSpaceShip(a.artifactType) && a.controller === account
  );

  let abandonRow;
  if (p.value && p.value.transactions?.hasTransaction(isUnconfirmedReleaseTx)) {
    abandonRow = (
      <Btn size="stretch" disabled>
        <LoadingSpinner initialText="Abandoning..." />
      </Btn>
    );
  } else if (p.value && !p.value.destroyed) {
    abandonRow = (
      <AbandonButton
        planet={p.value}
        abandoning={(isAbandoning ?? false) && !isSendingShip}
        toggleAbandoning={onToggleAbandon}
        disabled={isSendingShip}
      />
    );
  }

  let sendRow;
  if (p.value && p.value.transactions?.hasTransaction(isUnconfirmedMoveTx)) {
    sendRow = (
      <Btn size="stretch" disabled>
        <LoadingSpinner
          initialText={isSendingShip ? "Moving..." : "Sending..."}
        />
      </Btn>
    );
  } else {
    const isDisabled = (p.value?.destroyed || !owned) && !isSendingShip;
    sendRow = (
      <SendRow
        artifact={artifactSending}
        toggleSending={onToggleSendForces}
        sending={isSendingForces ?? false}
        disabled={isDisabled}
      />
    );
  }

  return (
    <StyledSendResources>
      {owned && !p.value?.destroyed && (
        <>
          <ResourceBar
            selected={p.value}
            value={energySending}
            setValue={updateEnergySending}
            disabled={disableSliders}
          />
          {p.value && p.value.silver > 0 && (
            <ResourceBar
              selected={p.value}
              value={silverSending}
              setValue={updateSilverSending}
              disabled={disableSliders}
              isSilver
            />
          )}
        </>
      )}
      {p.value && artifacts.length > 0 && (
        <SelectArtifactRow
          artifacts={artifacts}
          onArtifactChange={updateArtifactSending}
          selectedArtifact={artifactSending}
        />
      )}
      {spaceshipsYouOwn.length > 0 || owned ? sendRow : null}

      {uiManager.getSpaceJunkEnabled() && owned ? abandonRow : null}
    </StyledSendResources>
  );
}
