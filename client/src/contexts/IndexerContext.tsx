/**
 * IndexerContext: provides a single IndexerService instance and useIndexer hook
 * for real-time chain table state. Indexer is started on mount and destroyed on unmount.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { START_BLOCK } from "@dfpunk/contracts";
import { IndexerService, createAztecNodeBlockSource } from "../indexer";
import type { IndexerStatus, TableName, TableRowType } from "../indexer";
import type {
  WorldState,
  PlayerState,
  PlanetState,
  PlanetRevealedCoordsState,
  PlanetEventsState,
  PlanetArtifactsState,
  ArrivalState,
  ArtifactState,
  ArtifactLocationState,
} from "../types/chain";

const nodeUrl =
  typeof import.meta.env.VITE_AZTEC_NODE_URL === "string" &&
  import.meta.env.VITE_AZTEC_NODE_URL.length > 0
    ? import.meta.env.VITE_AZTEC_NODE_URL
    : "http://localhost:8080";

function createIndexer(): IndexerService {
  const source = createAztecNodeBlockSource(nodeUrl);
  return new IndexerService({
    source,
    startBlock: START_BLOCK,
    debounceMs: 1000,
    pollIntervalMs: 2000,
    maxBlocksPerRequest: 100,
  });
}

type IndexerContextValue = {
  indexer: IndexerService;
};

const IndexerContext = createContext<IndexerContextValue | null>(null);

export function IndexerProvider({ children }: { children: ReactNode }) {
  const [indexer] = useState(() => createIndexer());

  useEffect(() => {
    indexer.start();
    return () => indexer.destroy();
  }, [indexer]);

  const value: IndexerContextValue = { indexer };

  return (
    <IndexerContext.Provider value={value}>{children}</IndexerContext.Provider>
  );
}

// Hook exported from same file as provider for ergonomics; fast-refresh prefers components-only.
// eslint-disable-next-line react-refresh/only-export-components
export function useIndexer(): {
  status: IndexerStatus;
  world: WorldState | undefined;
  getProcessedBlockNumber: () => number;
  getLatestKnownBlock: () => number;
  getPlanet: (id: string) => PlanetState | undefined;
  getPlanetIds: () => string[];
  getPlanetRevealedCoords: (
    id: string
  ) => PlanetRevealedCoordsState | undefined;
  getPlanetEvents: (id: string) => PlanetEventsState | undefined;
  getPlanetArtifacts: (id: string) => PlanetArtifactsState | undefined;
  getPlayer: (id: string) => PlayerState | undefined;
  getPlayerIds: () => string[];
  getArrival: (id: string) => ArrivalState | undefined;
  getArrivalIds: () => string[];
  getArtifact: (id: string) => ArtifactState | undefined;
  getArtifactLocation: (id: string) => ArtifactLocationState | undefined;
  getTable: <K extends TableName>(
    table: K,
    id?: string
  ) => TableRowType[K] | Record<string, TableRowType[K]> | undefined;
} {
  const ctx = useContext(IndexerContext);
  if (ctx === null) {
    throw new Error("useIndexer must be used within IndexerProvider");
  }
  const { indexer } = ctx;

  const [, setTick] = useState(0);
  useEffect(() => {
    return indexer.subscribe(() => setTick((t: number) => t + 1));
  }, [indexer]);

  const status = indexer.getStatus();
  const world = indexer.getWorld();
  const getProcessedBlockNumber = useCallback(
    () => indexer.getProcessedBlockNumber(),
    [indexer]
  );
  const getLatestKnownBlock = useCallback(
    () => indexer.getLatestKnownBlock(),
    [indexer]
  );
  const getPlanet = useCallback(
    (id: string) => indexer.getPlanet(id),
    [indexer]
  );
  const getPlanetIds = useCallback(() => indexer.getPlanetIds(), [indexer]);
  const getPlanetRevealedCoords = useCallback(
    (id: string) => indexer.getPlanetRevealedCoords(id),
    [indexer]
  );
  const getPlanetEvents = useCallback(
    (id: string) => indexer.getPlanetEvents(id),
    [indexer]
  );
  const getPlanetArtifacts = useCallback(
    (id: string) => indexer.getPlanetArtifacts(id),
    [indexer]
  );
  const getPlayer = useCallback(
    (id: string) => indexer.getPlayer(id),
    [indexer]
  );
  const getPlayerIds = useCallback(() => indexer.getPlayerIds(), [indexer]);
  const getArrival = useCallback(
    (id: string) => indexer.getArrival(id),
    [indexer]
  );
  const getArrivalIds = useCallback(() => indexer.getArrivalIds(), [indexer]);
  const getArtifact = useCallback(
    (id: string) => indexer.getArtifact(id),
    [indexer]
  );
  const getArtifactLocation = useCallback(
    (id: string) => indexer.getArtifactLocation(id),
    [indexer]
  );
  const getTable = useCallback(
    <K extends TableName>(table: K, id?: string) => indexer.getTable(table, id),
    [indexer]
  );

  return {
    status,
    world,
    getProcessedBlockNumber,
    getLatestKnownBlock,
    getPlanet,
    getPlanetIds,
    getPlanetRevealedCoords,
    getPlanetEvents,
    getPlanetArtifacts,
    getPlayer,
    getPlayerIds,
    getArrival,
    getArrivalIds,
    getArtifact,
    getArtifactLocation,
    getTable,
  };
}
