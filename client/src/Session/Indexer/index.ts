/**
 * Indexer: block-by-block sync of chain table state with debounce,
 * optional init from off-chain indexer, and query API for tx inputs.
 */

export type { OffChainSourceOptions } from "./OffChainSource";
export { OffChainBlockSource } from "./OffChainSource";
export * from "@dfpunk/indexer-core";

// IndexerConnection — EthConnection-equivalent adapter
export type { IndexerConnectionConfig } from "./IndexerConnection";
export {
  createIndexerConnection,
  IndexerConnection,
} from "./IndexerConnection";
