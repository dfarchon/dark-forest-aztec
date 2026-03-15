import { ArtifactFileColor, artifactFileName } from "@dfpunk/gamelogic";
import { Artifact } from "@dfpunk/types";
import React from "react";
import styled, { css } from "styled-components";

import dfstyles from "../Styles/dfstyles";

// export const ARTIFACT_URL =
//   "https://d2wspbczt15cqu.cloudfront.net/v0.6.0-artifacts/";
export const ARTIFACT_URL = "/img/artifacts/videos/";

function getArtifactUrl(
  thumb: boolean,
  artifact: Artifact,
  color: ArtifactFileColor
): string {
  const fileName = artifactFileName(true, thumb, artifact, color);
  return ARTIFACT_URL + fileName;
}

export function ArtifactImage({
  artifact,
  size,
  thumb,
  bgColor,
}: {
  artifact: Artifact;
  size: number;
  thumb?: boolean;
  bgColor?: ArtifactFileColor;
}) {
  const url = getArtifactUrl(
    thumb || false,
    artifact,
    bgColor || ArtifactFileColor.BLUE
  );

  return (
    <Container width={size} height={size}>
      <img width={size} height={size} src={url} />
    </Container>
  );
}

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
