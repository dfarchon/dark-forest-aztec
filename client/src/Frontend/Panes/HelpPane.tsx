import { ArtifactRarity, ModalName } from "@dfpunk/types";
import React from "react";
import styled from "styled-components";

import { dfArchonLinks, externalLinks } from "../../config/externalLinks";
import { EmSpacer, Link, Section, SectionHeader } from "../Components/CoreUI";
import { ArtifactRarityLabel } from "../Components/Labels/ArtifactLabels";
import { Gold, White } from "../Components/Text";
import dfstyles from "../Styles/dfstyles";
import { useUIManager } from "../Utils/AppHooks";
import { ModalPane } from "../Views/ModalPane";

const HelpContent = styled.div`
  width: 500px;
  height: 500px;
  max-height: 500px;
  max-width: 500px;
  overflow-y: scroll;
  text-align: justify;
  color: ${dfstyles.colors.text};
`;

export function HelpPane({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const uiManager = useUIManager();

  const silverScoreValue = uiManager.getSilverScoreValue();
  const artifactPointValues = uiManager.getArtifactPointValues();

  return (
    <ModalPane
      id={ModalName.Help}
      title="Help"
      visible={visible}
      onClose={onClose}
    >
      <HelpContent>
        {uiManager.isRoundOver() && (
          <Section>
            <SectionHeader>Round Complete</SectionHeader>
            Dark Forest Aztec is now complete! Scores are being compiled and
            winners will be announced shortly. Also, Artifacts will no longer be
            mintable. Thanks for playing!
          </Section>
        )}

        <Section>
          <SectionHeader>Welcome to Dark Forest Aztec</SectionHeader>
          Dark Forest Aztec is a competitive strategy game set in a vast
          universe where most of the map is hidden. Your moves and plans are
          backed by zero-knowledge cryptography on <White>Aztec</White>, so
          players explore and fight without fully exposing their positions
          on-chain. Expand your empire, outthink rivals, and climb the
          scoreboard.
        </Section>

        <Section>
          <SectionHeader>How to Play</SectionHeader>
          Use your <White>explorer</White> (bottom left) to uncover{" "}
          <White>planets</White>, resources, and other players.
          <EmSpacer height={1} />
          Most planets produce <White>energy</White>. Click and drag to send
          energy from planets you own toward new targets to capture or weaken
          them.
          <EmSpacer height={1} />
          <White>Asteroid fields</White> produce <White>silver</White>. Route
          silver to your planets and spend it on <White>upgrades</White>.
          <EmSpacer height={1} />
          Some planets hold <White>artifacts</White>. Use your{" "}
          <White>Gear</White> ship to discover them, then harvest and deposit
          artifacts on planets to boost stats.
        </Section>

        <Section>
          <SectionHeader>Scoring</SectionHeader>
          This round&apos;s score comes from two activities: discovering
          artifacts with your Gear ship, and withdrawing silver from{" "}
          <White>Spacetime Rips</White>.
          <EmSpacer height={1} />
          Current point values from on-chain config:
        </Section>

        <Section>
          <SectionHeader>Silver (Spacetime Rip withdrawals)</SectionHeader>
          Each unit of <Gold>silver</Gold> you withdraw adds{" "}
          {silverScoreValue / 100} to your score.
        </Section>

        <Section>
          <SectionHeader>Artifacts (by rarity)</SectionHeader>
          Discovering an artifact adds points based on rarity:
          <br />
          <ArtifactRarityLabel rarity={ArtifactRarity.Common} />:{" "}
          {artifactPointValues[ArtifactRarity.Common]}
          <br />
          <ArtifactRarityLabel rarity={ArtifactRarity.Rare} />:{" "}
          {artifactPointValues[ArtifactRarity.Rare]}
          <br />
          <ArtifactRarityLabel rarity={ArtifactRarity.Epic} />:{" "}
          {artifactPointValues[ArtifactRarity.Epic]}
          <br />
          <ArtifactRarityLabel rarity={ArtifactRarity.Legendary} />:{" "}
          {artifactPointValues[ArtifactRarity.Legendary]}
          <br />
          <ArtifactRarityLabel rarity={ArtifactRarity.Mythic} />:{" "}
          {artifactPointValues[ArtifactRarity.Mythic]}
        </Section>

        <Section>
          <SectionHeader>Credits</SectionHeader>
          <White>Dark Forest</White> was created by the original{" "}
          <Link to={externalLinks.darkForest.zkgaMe}>zkga.me</Link> team, who
          pioneered the use of zk-SNARKs to build a fully on-chain game with
          hidden information. Their work, open-sourced over multiple community
          rounds, is the foundation that makes this experience possible.
          <EmSpacer height={1} />
          <White>Dark Forest Aztec</White> is a port by{" "}
          <Link to={dfArchonLinks.twitter}>DFArchon</Link>, built on top of that
          open-source codebase and reimagined for the{" "}
          <White>Aztec Network</White>, bringing private, programmable
          zero-knowledge state to the Dark Forest universe.
        </Section>

        <Section>
          <SectionHeader>Need Help?</SectionHeader>
          Run into a bug, have a question, or want to share feedback? Join us on{" "}
          <Link to={dfArchonLinks.discord}>DFArchon Discord</Link>. The team and
          community are happy to help.
        </Section>

        <Section>
          <SectionHeader>Useful Links</SectionHeader>
          <Link to={dfArchonLinks.blog}>Onchain Reality Blog</Link>
          <br />
          <Link to={dfArchonLinks.twitter}>DFArchon on X</Link>
          <br />
          <Link to={dfArchonLinks.discord}>DFArchon Discord</Link>
          <br />
          <Link to={dfArchonLinks.github}>DFArchon on GitHub</Link>
          <br />
        </Section>
      </HelpContent>
    </ModalPane>
  );
}
