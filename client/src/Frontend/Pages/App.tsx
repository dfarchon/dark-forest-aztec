import "./Test/TestPageStyles.css";

import { CORE_CONTRACT_ADDRESS } from "@dfpunk/contracts";
import { address } from "@dfpunk/serde";
import React from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import { createGlobalStyle } from "styled-components";

import { Theme } from "../Components/Theme";
import { ExternalWalletProvider } from "../Contexts/ExternalWalletContext";
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
    <div className="test-page" style={{ maxWidth: "960px" }}>
      <header className="test-page__header">
        <h1 className="test-page__title">DFPunk Aztec Client — Test</h1>
        <p style={{ margin: "0 0 12px", opacity: 0.85, fontSize: "0.9rem" }}>
          Wallet / TxExecutor use the same accelerator URL as the game landing
          page: env{" "}
          <code style={{ fontSize: "0.85em" }}>VITE_TEEREX_PROVER_URL</code> or
          Connection settings (localStorage).
        </p>
        <nav className="test-page__nav">
          <Link to="/">← Home</Link>
          <span className="test-page__nav-sep"> · </span>
          <Link to="/test/indexer">Indexer</Link>
          <span className="test-page__nav-sep"> · </span>
          <Link to="/test/wallet">WalletManager</Link>
          <span className="test-page__nav-sep"> · </span>
          <Link to="/test/tx-executor">TxExecutor</Link>
        </nav>
      </header>
    </div>
  );
}

function App() {
  return (
    <>
      <GlobalStyle />
      {/* Provides theming for WebComponents from the `@dfpunk/ui` package */}
      <Theme color="dark" scale="medium">
        <ExternalWalletProvider>
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
            {!isProd && (
              <Route path="/images" element={<TestArtifactImages />} />
            )}
            {!isProd && <Route path="/gifs" element={<GifMaker />} />}
            {!isProd && (
              <Route path="/bg" element={<LandingPageBackground />} />
            )}
            <Route path="/test" element={<TestHub />} />
            <Route path="/test/indexer" element={<IndexerTestPage />} />
            <Route path="/test/wallet" element={<WalletManagerTestPage />} />
            <Route path="/test/tx-executor" element={<TxExecutorTestPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </ExternalWalletProvider>
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
