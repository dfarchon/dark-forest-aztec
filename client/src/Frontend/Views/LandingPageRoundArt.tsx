import React from "react";
import styled from "styled-components";

import { TwitterLink } from "../Components/Labels/Labels";
import { Smaller, Text } from "../Components/Text";

export function LandingPageRoundArt() {
  return (
    <Container>
      <ImgContainer>
        <LandingPageRoundArtImg src={"/round_art/round5.jpg"} />
        <Smaller>
          <Text>Art by</Text> <TwitterLink twitter="JannehMoe" />{" "}
        </Smaller>
      </ImgContainer>
    </Container>
  );
}

const Container = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
`;

const ImgContainer = styled.div`
  display: inline-block;
  text-align: right;
  width: 750px;
  max-width: 80vw;

  @media only screen and (max-device-width: 1000px) {
    width: 100%;
    max-width: 100%;
    padding: 8px;
    font-size: 80%;
  }
`;

const ImgWrapper = styled.div`
  display: inline-block;
  transform-origin: center top;
`;

const SizeControl = styled.div`
  margin-top: 8px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
`;

const Spacer = styled.span<{ width: number }>`
  display: inline-block;
  width: ${(p) => p.width}px;
`;

const ScaleBtn = styled.button`
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.3);
  color: inherit;
  font-size: 1em;
  padding: 2px 8px;
  cursor: pointer;
  border-radius: 4px;
  &:hover {
    background: rgba(255, 255, 255, 0.2);
  }
`;

const ScaleValue = styled.span`
  min-width: 3em;
  display: inline-block;
  text-align: center;
`;

const LandingPageRoundArtImg = styled.img`
  display: block;
  max-width: 100%;
  height: auto;
`;
