import React from "react";
import styled from "styled-components";

import { externalLinks } from "../../config/externalLinks";

const Container = styled.div`
  width: 100vw;
  height: 100vh;
  display: flex;
  justify-content: center;
  align-items: center;
  flex-direction: column;
  text-align: center;
`;

export function ValhallaPage() {
  window.location.href = externalLinks.darkForest.valhalla;

  return <Container></Container>;
}
