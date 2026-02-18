import * as React from "react";
import { Link, Route, Routes } from "react-router-dom";

import { IndexerTestPage } from "./Test";

function Home() {
  return (
    <div className="card">
      <h1>DFPunk Aztec Client</h1>
      <p>
        DFPunk Aztec — Dark Forest on Aztec. Display page; more features later.
      </p>
      <p>
        <Link to="/test/indexer">Indexer</Link>
      </p>
    </div>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/test/indexer" element={<IndexerTestPage />} />
    </Routes>
  );
}

export default App;
