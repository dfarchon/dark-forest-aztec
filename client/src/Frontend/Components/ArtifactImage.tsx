import { ArtifactFileColor } from "@dfpunk/gamelogic";
import { ARTIFACTS_THUMBS_URL, spriteFromArtifact } from "@dfpunk/renderer";
import { Artifact } from "@dfpunk/types";
import React from "react";
import styled, { css } from "styled-components";

import dfstyles from "../Styles/dfstyles";

/** Kept for the artifact image test page. Pane icons use the viewport sprite sheet. */
export const ARTIFACT_URL = "/img/artifacts/videos/";

const SPRITES_PER_ROW = 16;

export function ArtifactImage({
  artifact,
  size,
  thumb: _thumb,
  bgColor: _bgColor,
}: {
  artifact: Artifact;
  size: number;
  thumb?: boolean;
  bgColor?: ArtifactFileColor;
}) {
  const rect = spriteFromArtifact(artifact);
  const cell = SPRITES_PER_ROW * size;
  const x = rect.x1 * cell;
  const y = rect.y1 * cell;

  return (
    <Container width={size} height={size}>
      <Sprite
        width={size}
        height={size}
        style={{
          backgroundImage: `url(${ARTIFACTS_THUMBS_URL})`,
          backgroundSize: `${cell}px ${cell}px`,
          backgroundPosition: `-${x}px -${y}px`,
        }}
      />
    </Container>
  );
}

const Sprite = styled.div<{ width: number; height: number }>`
  image-rendering: pixelated;
  image-rendering: crisp-edges;
  background-repeat: no-repeat;
  ${({ width, height }) => css`
    width: ${width}px;
    height: ${height}px;
  `}
`;

const Container = styled.div`
  image-rendering: crisp-edges;

  ${({ width, height }: { width: number; height: number }) => css`
    width: ${width}px;
    height: ${height}px;
    min-width: ${width}px;
    min-height: ${height}px;
    background-color: ${dfstyles.colors.artifactBackground};
    display: inline-block;
  `}
`;
