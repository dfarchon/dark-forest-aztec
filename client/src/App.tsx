import { Link, Route, Routes } from "react-router-dom";
import IndexerPage from "./pages/IndexerPage";
import "./App.css";

function Home() {
  return (
    <div className="card">
      <h1>DFPunk Aztec</h1>
      <p>
        <Link to="/indexer">Indexer</Link>
      </p>
    </div>
  );
}

function App() {
  return (
    <>
      <nav style={{ marginBottom: "1.5rem" }}>
        <Link to="/" style={{ marginRight: "1rem" }}>
          Home
        </Link>
        <Link to="/indexer">Indexer</Link>
      </nav>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/indexer" element={<IndexerPage />} />
      </Routes>
    </>
  );
}

export default App;
