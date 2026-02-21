import * as React from "react";
import { Link, Route, Routes } from "react-router-dom";

import {
  IndexerTestPage,
  TxExecutorTestPage,
  WalletManagerTestPage,
} from "./Test";

function Home() {
  return (
    <div className="card">
      <h1>DFPunk Aztec Client</h1>
      <p>
        DFPunk Aztec — Dark Forest on Aztec. Display page; more features later.
      </p>
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
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/test/indexer" element={<IndexerTestPage />} />
      <Route path="/test/wallet" element={<WalletManagerTestPage />} />
      <Route path="/test/tx-executor" element={<TxExecutorTestPage />} />
    </Routes>
  );
}

export default App;
