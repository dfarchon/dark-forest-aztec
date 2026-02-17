import type { GasPrices } from "../settings/gas_prices";

export interface Diagnostics {
  visiblePlanets: number;
  visibleChunks: number;
  fps: number;
  totalPlanets: number;
  chunkUpdates: number;
  totalCalls: number;
  callsInQueue: number;
  totalTransactions: number;
  transactionsInQueue: number;
  totalChunks: number;
  gasPrices?: GasPrices;
  rpcUrl: string;
  width?: number;
  height?: number;
}

/**
 * Various parts of our codebase need to be able to self-report diagnostics.
 */
export interface DiagnosticUpdater {
  updateDiagnostics: (updateFn: (d: Diagnostics) => void) => void;
}
