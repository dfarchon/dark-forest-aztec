import { CORE_CONTRACT_ADDRESS } from "@dfpunk/contracts";
import { address } from "@dfpunk/serde";
import React from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import { createGlobalStyle } from "styled-components";

import { Theme } from "../Components/Theme";
import { LandingPageBackground } from "../Renderers/LandingPageCanvas";
import dfstyles from "../Styles/dfstyles";
import { EventsPage } from "./EventsPage";
import { GameLandingPage } from "./GameLandingPage";
import { GifMaker } from "./GifMaker";
import LandingPage from "./LandingPage";
import { NotFoundPage } from "./NotFoundPage";
import {
  IndexerTestPage,
  TxExecutorTestPage,
  WalletManagerTestPage,
} from "./Test";
import { TestArtifactImages } from "./TestArtifactImages";
import { TxConfirmPopup } from "./TxConfirmPopup";
import UnsubscribePage from "./UnsubscribePage";
import { ValhallaPage } from "./ValhallaPage";

const isProd = process.env.NODE_ENV === "production";

const defaultAddress = address(CORE_CONTRACT_ADDRESS);

function TestHub() {
  return (
    <div className="card">
      <h1>DFPunk Aztec Client — Test</h1>
      <p>
        <Link to="/test/indexer">Indexer</Link>
        {" · "}
        <Link to="/test/wallet">WalletManager</Link>
        {" · "}
        <Link to="/test/tx-executor">TxExecutor</Link>
      </p>
    </div>
  );
}

function App() {
  return (
    <>
      <GlobalStyle />
      {/* Provides theming for WebComponents from the `@dfpunk/ui` package */}
      <Theme color="dark" scale="medium">
        <Routes>
          <Route
            path="/play"
            element={<Navigate to={`/play/${defaultAddress}`} replace />}
          />
          <Route path="/play/:contract" element={<GameLandingPage />} />
          <Route path="/events" element={<EventsPage />} />
          <Route path="/" element={<LandingPage />} />
          <Route
            path="/lobby"
            element={<Navigate to={`/lobby/${defaultAddress}`} replace />}
          />
          <Route
            path="/wallet/:contract/:addr/:actionId/:balance/:method"
            element={<TxConfirmPopup />}
          />
          <Route path="/unsubscribe" element={<UnsubscribePage />} />
          <Route path="/valhalla" element={<ValhallaPage />} />
          {!isProd && <Route path="/images" element={<TestArtifactImages />} />}
          {!isProd && <Route path="/gifs" element={<GifMaker />} />}
          {!isProd && <Route path="/bg" element={<LandingPageBackground />} />}
          <Route path="/test" element={<TestHub />} />
          <Route path="/test/indexer" element={<IndexerTestPage />} />
          <Route path="/test/wallet" element={<WalletManagerTestPage />} />
          <Route path="/test/tx-executor" element={<TxExecutorTestPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Theme>
    </>
  );
}

const GlobalStyle = createGlobalStyle`
body {
  width: 100vw;
  min-height: 100vh;
  background-color: ${dfstyles.colors.background};
}
`;

export default App;
