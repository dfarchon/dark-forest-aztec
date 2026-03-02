import { Fr } from "@aztec/aztec.js/fields";
import { poseidon2Hash } from "@aztec/foundation/crypto/poseidon";
import {
  BLOCK_EXPLORER_URL,
  CONTRACT_PRECISION,
  EMPTY_ADDRESS,
  MIN_PLANET_LEVEL,
} from "@dfpunk/constants";
import { Monomitter, monomitter, Subscription } from "@dfpunk/events";
import {
  getDMaxFraction,
  getRange,
  isActivated,
  isLocatable,
  isSpaceShip,
  L_OVER_RANGE,
  timeUntilNextBroadcastAvailable,
} from "@dfpunk/gamelogic";
import { fakeHash, initPoseidon2, perlin } from "@dfpunk/hashing";
import { getPlanetName } from "@dfpunk/procedural";
import {
  artifactIdToDecStr,
  isUnconfirmedActivateArtifactTx,
  isUnconfirmedBuyHatTx,
  isUnconfirmedCapturePlanetTx,
  isUnconfirmedCreatePlanetTx,
  isUnconfirmedDeactivateArtifactTx,
  isUnconfirmedDepositArtifactTx,
  isUnconfirmedFindArtifactTx,
  isUnconfirmedInitTx,
  isUnconfirmedInvadePlanetTx,
  isUnconfirmedMoveTx,
  isUnconfirmedPauseGameTx,
  isUnconfirmedProspectPlanetTx,
  isUnconfirmedRevealTx,
  isUnconfirmedSafeSetOwnerTx,
  isUnconfirmedUnpauseGameTx,
  isUnconfirmedUpgradeTx,
  isUnconfirmedWithdrawArtifactTx,
  isUnconfirmedWithdrawSilverTx,
  locationIdFromBigInt,
  locationIdToDecStr,
} from "@dfpunk/serde";
import type { WorldConfig } from "@dfpunk/types";
import {
  Artifact,
  ArtifactId,
  ArtifactRarity,
  ArtifactType,
  CaptureZone,
  Chunk,
  ClaimedCoords,
  ClaimedLocation,
  Diagnostics,
  EthAddress,
  LocatablePlanet,
  LocationId,
  NetworkHealthSummary,
  Planet,
  PlanetLevel,
  PlanetMessageType,
  PlanetType,
  Player,
  QueuedArrival,
  Radii,
  Rectangle,
  RevealedCoords,
  RevealedLocation,
  Setting,
  SignedMessage,
  SpaceType,
  Transaction,
  TxIntent,
  UnconfirmedActivateArtifact,
  UnconfirmedBuyHat,
  UnconfirmedCapturePlanet,
  UnconfirmedClaimReward,
  UnconfirmedCreatePlanet,
  UnconfirmedDeactivateArtifact,
  UnconfirmedDepositArtifact,
  UnconfirmedFindArtifact,
  UnconfirmedInit,
  UnconfirmedInvadePlanet,
  UnconfirmedMove,
  UnconfirmedPauseGame,
  UnconfirmedPlanetTransfer,
  UnconfirmedProspectPlanet,
  UnconfirmedReveal,
  UnconfirmedSafeSetOwner,
  UnconfirmedSetWorldConfig,
  UnconfirmedUnpauseGame,
  UnconfirmedUpgrade,
  UnconfirmedWithdrawArtifact,
  UnconfirmedWithdrawSilver,
  Upgrade,
  VoyageId,
  WorldCoords,
  WorldLocation,
  Wormhole,
} from "@dfpunk/types";
import bigInt, { BigInteger } from "big-integer";
import { EventEmitter } from "events";

import {
  HashConfig,
  RevealCountdownInfo,
} from "../../_types/global/GlobalTypes";
// import { CaptureZoneGenerator, CaptureZonesGeneratedEvent } from './CaptureZoneGenerator';
import { ContractsAPI } from "../../ContractsAPI";
import type { ContractConstants } from "../../ContractsAPI/ContractsAPITypes";
import { ContractsAPIEvent } from "../../ContractsAPI/ContractsAPITypes";
import NotificationManager from "../../Frontend/Game/NotificationManager";
import { MIN_CHUNK_SIZE } from "../../Frontend/Utils/constants";
import {
  Diff,
  generateDiffEmitter,
  getDisposableEmitter,
} from "../../Frontend/Utils/EmitterUtils";
import {
  getBooleanSetting,
  getNumberSetting,
  pollSetting,
  setBooleanSetting,
  setSetting,
  settingChanged$,
} from "../../Frontend/Utils/SettingsHooks";
import { TerminalTextStyle } from "../../Frontend/Utils/TerminalTypes";
import UIEmitter from "../../Frontend/Utils/UIEmitter";
import { TerminalHandle } from "../../Frontend/Views/Terminal";
import { ThrottledConcurrentQueue } from "../../Session/TxExecutor";
import MinerManager, {
  HomePlanetMinerChunkStore,
  MinerManagerEvent,
} from "../Miner/MinerManager";
import {
  MiningPattern,
  SpiralPattern,
  SwissCheesePattern,
  TowardsCenterPattern,
  TowardsCenterPatternV2,
} from "../Miner/MiningPatterns";
import { SerializedPlugin } from "../Plugins/SerializedPlugin";
import PersistentChunkStore from "../Storage/PersistentChunkStore";
import { easeInAnimation, emojiEaseOutAnimation } from "../Utils/Animation";
import { ChainClock } from "../Utils/ChainClock";
import { weiToEth } from "../Utils/Utils";
import { hexifyBigIntNestedArray } from "../Utils/Utils";
import { getEmojiMessage } from "./ArrivalUtils";
import { GameObjects } from "./GameObjects";
import { InitialGameStateDownloader } from "./InitialGameStateDownloader";

export enum GameManagerEvent {
  PlanetUpdate = "PlanetUpdate",
  DiscoveredNewChunk = "DiscoveredNewChunk",
  InitializedPlayer = "InitializedPlayer",
  InitializedPlayerError = "InitializedPlayerError",
  ArtifactUpdate = "ArtifactUpdate",
  Moved = "Moved",
}

/** Helper for Poseidon2 inputs (matches miner.worker). */
function toFr(n: number): Fr {
  const v = BigInt(n);
  return new Fr(v < 0n ? v + Fr.MODULUS : v);
}
class GameManager extends EventEmitter {
  /**
   * This variable contains the internal state of objects that live in the game world.
   */
  private readonly entityStore: GameObjects;

  /** Chain-adjusted clock for game-time calculations. */
  private readonly chainClock: ChainClock;

  /**
   * Kind of hacky, but we store a reference to the terminal that the player sees when the initially
   * load into the game. This is the same exact terminal that appears inside the collapsable right
   * bar of the game.
   */
  private readonly terminal: React.MutableRefObject<TerminalHandle | undefined>;

  /**
   * The ethereum address of the player who is currently logged in. We support 'no account',
   * represented by `undefined` in the case when you want to simply load the game state from the
   * contract and view it without be able to make any moves.
   */
  private readonly account: EthAddress | undefined;

  /**
   * Map from ethereum addresses to player objects. This isn't stored in {@link GameObjects},
   * because it's not techincally an entity that exists in the world. A player just controls planets
   * and artifacts that do exist in the world.
   *
   * @todo move this into a new `Players` class.
   */
  private readonly players: Map<string, Player>;

  /**
   * Allows us to make contract calls, and execute transactions. Be careful about how you use this
   * guy. You don't want to cause your client to send an excessive amount of traffic to whatever
   * node you're connected to.
   *
   * Interacting with the blockchain isn't free, and we need to be mindful about about the way our
   * application interacts with the blockchain. The current rate limiting strategy consists of three
   * points:
   *
   * - data that needs to be fetched often should be fetched in bulk.
   * - rate limit smart contract calls (reads from the blockchain), implemented by
   *   {@link ContractCaller} and transactions (writes to the blockchain on behalf of the player),
   *   implemented by {@link TxExecutor} via two separately tuned {@link ThrottledConcurrentQueue}s.
   */
  private readonly contractsAPI: ContractsAPI;

  /**
   * An object that syncs any newly added or deleted chunks to the player's IndexedDB.
   *
   * @todo it also persists other game data to IndexedDB. This class needs to be renamed `GameSaver`
   * or something like that.
   */
  private readonly persistentChunkStore: PersistentChunkStore;

  /**
   * In debug builds of the game, we can connect to a set of contracts deployed to a local
   * blockchain, which are tweaked to not verify planet hashes, meaning we can use a faster hash
   * function with similar properties to Poseidon2. This allows us to mine the map faster in debug mode.
   *
   * @todo move this into a separate `GameConfiguration` class.
   */
  private readonly useMockHash: boolean;

  /**
   * Game parameters set by the contract. Stuff like perlin keys, which are important for mining the
   * correct universe, or the time multiplier, which allows us to tune how quickly voyages go.
   *
   * @todo move this into a separate `GameConfiguration` class.
   */
  private readonly contractConstants: ContractConstants;

  private paused: boolean;

  /**
   * @todo change this to the correct timestamp each round.
   */
  private readonly endTimeSeconds: number = 1948939200; // new Date("2031-10-05T04:00:00.000Z").getTime() / 1000

  /**
   * Connection adapter for UI compatibility: exposes blockNumber$, myBalance$, getAddress
   * from IndexerConnection + WalletManager. Use contractsAPI for all real operations.
   */
  public getEthConnection(): {
    blockNumber$: Monomitter<number>;
    myBalance$: Monomitter<bigint>;
    getAddress: () => EthAddress | undefined;
  } {
    return {
      blockNumber$: this.contractsAPI.indexerConnection.blockNumber$,
      myBalance$: this.contractsAPI.getWalletManager().myBalance$,
      getAddress: () => this.contractsAPI.getAddress(),
    };
  }

  /**
   * Each round we change the hash configuration of the game. The hash configuration is download
   * from the blockchain, and essentially acts as a salt, permuting the universe into a unique
   * configuration for each new round.
   *
   * @todo deduplicate this and `useMockHash` somehow.
   */
  private readonly hashConfig: HashConfig;

  /**
   * In debug mode (DISABLE_ZK_CHECKS) we use fakeHash; otherwise Poseidon2, matching the miner and contracts.
   */
  private async planetHashAt(x: number, y: number): Promise<bigint> {
    if (this.useMockHash) {
      const fake = fakeHash(this.hashConfig.planetRarity);
      return BigInt(fake(x, y).toString());
    }
    const result = await poseidon2Hash([
      new Fr(BigInt(this.hashConfig.planetHashKey)),
      toFr(x),
      toFr(y),
    ]);
    const hexString = result.toString().replace(/^0x/, "");
    return BigInt("0x" + hexString);
  }

  /**
   * Whenever we refresh the players twitter accounts or scores, we publish an event here.
   */
  public readonly playersUpdated$: Monomitter<void>;

  /**
   * Handle to an interval that periodically uploads diagnostic information from this client.
   */
  private diagnosticsInterval: ReturnType<typeof setInterval>;

  /**
   * Handle to an interval that periodically refreshes some information about the player from the
   * blockchain.
   *
   * @todo move this into a new `PlayerState` class.
   */
  private playerInterval: ReturnType<typeof setInterval>;

  /**
   * Handle to an interval that periodically refreshes the scoreboard from our webserver.
   */
  private scoreboardInterval: ReturnType<typeof setInterval>;

  /**
   * Handle to an interval that periodically refreshes the network's health from our webserver.
   */
  private networkHealthInterval: ReturnType<typeof setInterval>;

  /**
   * Manages the process of mining new space territory.
   */
  private minerManager?: MinerManager;

  /**
   * Continuously updated value representing the total hashes per second that the game is currently
   * mining the universe at.
   *
   * @todo keep this in {@link MinerManager}
   */
  private hashRate: number;

  /**
   * The spawn location of the current player.
   *
   * @todo, make this smarter somehow. It's really annoying to have to import world coordinates, and
   * get them wrong or something. Maybe we need to mark a planet, once it's been initialized
   * contract-side, as the homeworld of the user who initialized on it. That way, when you import a
   * new account into the game, and you import map data that contains your home planet, the client
   * would be able to automatically detect which planet is the player's home planet.
   *
   * @todo move this into a new `PlayerState` class.
   */
  private homeLocation: WorldLocation | undefined;

  /**
   * Sometimes the universe gets bigger... Sometimes it doesn't.
   *
   * @todo move this into a new `GameConfiguration` class.
   */
  private worldRadius: number;

  /**
   * Emits whenever we load the network health summary from the webserver, which is derived from
   * diagnostics that the client sends up to the webserver as well.
   */
  public networkHealth$: Monomitter<NetworkHealthSummary>;

  public paused$: Monomitter<boolean>;

  /**
   * Diagnostic information about the game.
   */
  private diagnostics: Diagnostics;

  /**
   * Subscription to act on setting changes
   */
  private settingsSubscription: Subscription | undefined;

  /**
   * Setting to allow players to start game without plugins that were running during the previous
   * run of the game client. By default, the game launches plugins that were running that were
   * running when the game was last closed.
   */
  private safeMode: boolean;

  public get planetRarity(): number {
    return this.contractConstants.PLANET_RARITY;
  }

  /**
   * Generates capture zones.
   */
  // private captureZoneGenerator: CaptureZoneGenerator | undefined;

  private constructor(
    terminal: React.MutableRefObject<TerminalHandle | undefined>,
    account: EthAddress | undefined,
    players: Map<string, Player>,
    touchedPlanets: Map<LocationId, Planet>,
    allTouchedPlanetIds: Set<LocationId>,
    revealedLocations: Map<LocationId, RevealedLocation>,
    claimedLocations: Map<LocationId, ClaimedLocation>,
    worldRadius: number,
    unprocessedArrivals: Map<VoyageId, QueuedArrival>,
    unprocessedPlanetArrivalIds: Map<LocationId, VoyageId[]>,
    contractsAPI: ContractsAPI,
    contractConstants: ContractConstants,
    persistentChunkStore: PersistentChunkStore,
    homeLocation: WorldLocation | undefined,
    useMockHash: boolean,
    artifacts: Map<ArtifactId, Artifact>,
    paused: boolean,
    chainClock: ChainClock
  ) {
    super();

    this.diagnostics = {
      rpcUrl: "unknown",
      totalPlanets: 0,
      visiblePlanets: 0,
      visibleChunks: 0,
      fps: 0,
      chunkUpdates: 0,
      callsInQueue: 0,
      totalCalls: 0,
      totalTransactions: 0,
      transactionsInQueue: 0,
      totalChunks: 0,
      width: 0,
      height: 0,
    };
    this.terminal = terminal;
    this.account = account;
    this.players = players;
    this.worldRadius = worldRadius;
    this.networkHealth$ = monomitter(true);
    this.paused$ = monomitter(true);
    this.playersUpdated$ = monomitter();

    // if (contractConstants.CAPTURE_ZONES_ENABLED) {
    //   this.captureZoneGenerator = new CaptureZoneGenerator(
    //     this,
    //     contractConstants.GAME_START_BLOCK,
    //     contractConstants.CAPTURE_ZONE_CHANGE_BLOCK_INTERVAL
    //   );
    // }

    this.hashConfig = {
      planetHashKey: contractConstants.PLANETHASH_KEY,
      spaceTypeKey: contractConstants.SPACETYPE_KEY,
      biomebaseKey: contractConstants.BIOMEBASE_KEY,
      perlinLengthScale: contractConstants.PERLIN_LENGTH_SCALE,
      perlinMirrorX: contractConstants.PERLIN_MIRROR_X,
      perlinMirrorY: contractConstants.PERLIN_MIRROR_Y,
      planetRarity: contractConstants.PLANET_RARITY,
    };

    this.contractConstants = contractConstants;
    this.homeLocation = homeLocation;

    this.entityStore = new GameObjects(
      account,
      touchedPlanets,
      allTouchedPlanetIds,
      revealedLocations,
      claimedLocations,
      artifacts,
      persistentChunkStore.allChunks(),
      unprocessedArrivals,
      unprocessedPlanetArrivalIds,
      contractConstants,
      worldRadius,
      chainClock
    );

    this.chainClock = chainClock;
    this.contractsAPI = contractsAPI;
    this.persistentChunkStore = persistentChunkStore;
    this.useMockHash = useMockHash;
    this.paused = paused;

    this.diagnosticsInterval = setInterval(
      this.uploadDiagnostics.bind(this),
      10_000
    );
    this.scoreboardInterval = setInterval(
      this.refreshScoreboard.bind(this),
      10_000
    );
    this.networkHealthInterval = setInterval(
      this.refreshNetworkHealth.bind(this),
      10_000
    );

    this.playerInterval = setInterval(() => {
      if (this.account) {
        this.hardRefreshPlayer(this.account);
      }
    }, 5000);

    this.contractsAPI.indexerConnection.blockNumber$.subscribe(() => {
      this.chainClock.resync().then(() => {
        this.entityStore.flushMaturedArrivals();
      });
    });

    this.hashRate = 0;

    this.settingsSubscription = settingChanged$.subscribe(
      (setting: Setting) => {
        if (setting === Setting.MiningCores) {
          if (this.minerManager) {
            const config = {
              contractAddress: this.getContractAddress(),
              account: this.account,
            };
            const cores = getNumberSetting(config, Setting.MiningCores);
            this.minerManager.setCores(cores);
          }
        }
      }
    );

    this.refreshScoreboard();
    this.refreshNetworkHealth();
    this.getSpaceships();

    this.safeMode = false;
  }

  private async uploadDiagnostics() {
    // todo: remove
    // eventLogger.logEvent(EventType.Diagnostics, this.diagnostics);
  }

  private async refreshNetworkHealth() {
    try {
      // todo: remove
      // this.networkHealth$.publish(await loadNetworkHealth());
    } catch (e) {
      // @todo - what do we do if we can't connect to the webserver
    }
  }

  private async refreshScoreboard() {
    try {
      // todo: fix this when we have a leaderboard
      // const leaderboard = []; //await loadLeaderboard();

      // for (const entry of leaderboard.entries) {
      //   const player = this.players.get(entry.ethAddress);
      //   if (player) {
      //     // current player's score is updated via `this.playerInterval`
      //     if (player.address !== this.account && entry.score !== undefined) {
      //       player.score = entry.score;
      //     }
      //   }
      // }

      this.playersUpdated$.publish();
    } catch (e) {
      // @todo - what do we do if we can't connect to the webserver? in general this should be a
      // valid state of affairs because arenas is a thing.
    }
  }

  public destroy(): void {
    // removes singletons of ContractsAPI, LocalStorageManager, MinerManager
    if (this.minerManager) {
      this.minerManager.removeAllListeners(
        MinerManagerEvent.DiscoveredNewChunk
      );
      this.minerManager.destroy();
    }
    this.contractsAPI.destroy();
    this.persistentChunkStore.destroy();
    clearInterval(this.playerInterval);
    clearInterval(this.diagnosticsInterval);
    clearInterval(this.scoreboardInterval);
    clearInterval(this.networkHealthInterval);
    this.settingsSubscription?.unsubscribe();
  }

  /**
   * Create GameManager. Caller must build ContractsAPI from Session
   * (indexerConnection, txExecutor, walletManager, configCache) and pass it in.
   */
  static async create({
    contractsAPI,
    terminal,
    contractAddress,
    chainClock,
  }: {
    contractsAPI: ContractsAPI;
    terminal: React.MutableRefObject<TerminalHandle | undefined>;
    contractAddress: EthAddress;
    chainClock: ChainClock;
  }): Promise<GameManager> {
    if (!terminal.current) {
      throw new Error("you must pass in a handle to a terminal");
    }

    const account = contractsAPI.getAddress();
    if (!account) {
      throw new Error("no account: wallet has no active address");
    }

    const gameStateDownloader = new InitialGameStateDownloader(
      terminal.current
    );

    terminal.current?.println("Loading game data from disk...");

    const persistentChunkStore = await PersistentChunkStore.create({
      account,
      contractAddress,
    });

    terminal.current?.println("Downloading data from Ethereum blockchain...");
    terminal.current?.println(
      "(the contract is very big. this may take a while)"
    );
    terminal.current?.newline();

    const initialState = await gameStateDownloader.download(
      contractsAPI,
      persistentChunkStore
    );
    const possibleHomes = await persistentChunkStore.getHomeLocations();

    terminal.current?.println("");
    terminal.current?.println("Building Index...");

    await persistentChunkStore.saveTouchedPlanetIds(
      initialState.allTouchedPlanetIds
    );
    await persistentChunkStore.saveRevealedCoords(
      initialState.allRevealedCoords
    );

    const knownArtifacts: Map<ArtifactId, Artifact> = new Map();

    for (let i = 0; i < initialState.loadedPlanets.length; i++) {
      const planet = initialState.touchedAndLocatedPlanets.get(
        initialState.loadedPlanets[i]
      );

      if (!planet) {
        continue;
      }

      planet.heldArtifactIds = initialState.heldArtifacts[i].map((a) => a.id);

      for (const heldArtifact of initialState.heldArtifacts[i]) {
        knownArtifacts.set(heldArtifact.id, heldArtifact);
      }
    }

    for (const myArtifact of initialState.myArtifacts) {
      knownArtifacts.set(myArtifact.id, myArtifact);
    }

    for (const artifact of initialState.artifactsOnVoyages) {
      knownArtifacts.set(artifact.id, artifact);
    }

    // figure out what's my home planet
    let homeLocation: WorldLocation | undefined = undefined;
    for (const loc of possibleHomes) {
      if (initialState.allTouchedPlanetIds.includes(loc.hash)) {
        homeLocation = loc;
        await persistentChunkStore.confirmHomeLocation(loc);
        break;
      }
    }

    const hashConfig: HashConfig = {
      planetHashKey: initialState.contractConstants.PLANETHASH_KEY,
      spaceTypeKey: initialState.contractConstants.SPACETYPE_KEY,
      biomebaseKey: initialState.contractConstants.BIOMEBASE_KEY,
      perlinLengthScale: initialState.contractConstants.PERLIN_LENGTH_SCALE,
      perlinMirrorX: initialState.contractConstants.PERLIN_MIRROR_X,
      perlinMirrorY: initialState.contractConstants.PERLIN_MIRROR_Y,
      planetRarity: initialState.contractConstants.PLANET_RARITY,
    };

    await initPoseidon2();

    const useMockHash = initialState.contractConstants.DISABLE_ZK_CHECKS;

    const perlinOpts = {
      scale: initialState.contractConstants.PERLIN_LENGTH_SCALE,
      mirrorX: initialState.contractConstants.PERLIN_MIRROR_X,
      mirrorY: initialState.contractConstants.PERLIN_MIRROR_Y,
      floor: true as const,
    };
    const revealedLocations = new Map<LocationId, RevealedLocation>();
    for (const [locationId, coords] of initialState.revealedCoordsMap) {
      const planet = initialState.touchedAndLocatedPlanets.get(locationId);
      if (planet) {
        const biomebase = perlin(coords, {
          ...perlinOpts,
          key: initialState.contractConstants.BIOMEBASE_KEY,
        });
        revealedLocations.set(locationId, {
          hash: locationId,
          coords,
          perlin: planet.perlin,
          biomebase,
          revealer: coords.revealer,
        });
      }
    }
    const claimedLocations = new Map<LocationId, ClaimedLocation>();
    const claimedCoordsMap = initialState.claimedCoordsMap
      ? initialState.claimedCoordsMap
      : new Map<LocationId, ClaimedCoords>();
    for (const [locationId, coords] of claimedCoordsMap) {
      const planet = initialState.touchedAndLocatedPlanets.get(locationId);
      if (planet) {
        const biomebase = perlin(coords, {
          ...perlinOpts,
          key: initialState.contractConstants.BIOMEBASE_KEY,
        });
        const location: ClaimedLocation = {
          hash: locationId,
          coords,
          perlin: planet.perlin,
          biomebase,
          revealer: coords.revealer,
        };
        claimedLocations.set(locationId, location);
      }
    }

    const gameManager = new GameManager(
      terminal,
      account,
      initialState.players,
      initialState.touchedAndLocatedPlanets,
      new Set(Array.from(initialState.allTouchedPlanetIds)),
      revealedLocations,
      claimedLocations,
      initialState.worldRadius,
      initialState.arrivals,
      initialState.planetVoyageIdMap,
      contractsAPI,
      initialState.contractConstants,
      persistentChunkStore,
      homeLocation,
      useMockHash,
      knownArtifacts,
      initialState.paused,
      chainClock
    );

    // gameManager.setPlayerTwitters(initialState.twitters);

    const config = {
      contractAddress,
      account: gameManager.getAccount(),
    };
    pollSetting(config, Setting.AutoApproveNonPurchaseTransactions);

    persistentChunkStore.setDiagnosticUpdater(gameManager);
    contractsAPI.setDiagnosticUpdater(gameManager);

    // important that this happens AFTER we load the game state from the blockchain. Otherwise our
    // 'loading game state' contract calls will be competing with events from the blockchain that
    // are happening now, which makes no sense.
    contractsAPI.setupEventListeners();

    // get twitter handles
    // gameManager.refreshTwitters();

    // gameManager.listenForNewBlock();

    // set up listeners: whenever ContractsAPI reports some game state update, do some logic
    gameManager.contractsAPI
      .on(ContractsAPIEvent.ArtifactUpdate, async (artifactId: ArtifactId) => {
        await gameManager.hardRefreshArtifact(artifactId);
        gameManager.emit(GameManagerEvent.ArtifactUpdate, artifactId);
      })
      .on(
        ContractsAPIEvent.PlanetTransferred,
        async (planetId: LocationId, newOwner: EthAddress) => {
          await gameManager.hardRefreshPlanet(planetId);
          const planetAfter = gameManager.getPlanetWithId(planetId);

          if (planetAfter && newOwner === gameManager.account) {
            NotificationManager.getInstance().receivedPlanet(planetAfter);
          }
        }
      )
      .on(ContractsAPIEvent.PlayerUpdate, async (playerId: EthAddress) => {
        await gameManager.hardRefreshPlayer(playerId);
      })
      .on(ContractsAPIEvent.PauseStateChanged, async (paused: boolean) => {
        gameManager.paused = paused;
        gameManager.paused$.publish(paused);
      })
      .on(ContractsAPIEvent.PlanetUpdate, async (planetId: LocationId) => {
        // don't reload planets that you don't have in your map. once a planet
        // is in your map it will be loaded from the contract.
        const localPlanet = gameManager.entityStore.getPlanetWithId(planetId);

        if (localPlanet && isLocatable(localPlanet)) {
          await gameManager.hardRefreshPlanet(planetId);
          gameManager.emit(GameManagerEvent.PlanetUpdate);
        }
      })
      .on(
        ContractsAPIEvent.ArrivalQueued,
        async (_arrivalId: VoyageId, fromId: LocationId, toId: LocationId) => {
          // only reload planets if the toPlanet is in the map
          const localToPlanet = gameManager.entityStore.getPlanetWithId(toId);
          if (localToPlanet && isLocatable(localToPlanet)) {
            await gameManager.bulkHardRefreshPlanets([fromId, toId]);
            gameManager.emit(GameManagerEvent.PlanetUpdate);
          }
        }
      )
      .on(
        ContractsAPIEvent.LocationRevealed,
        async (planetId: LocationId, _revealer: EthAddress) => {
          // TODO: hook notifs or emit event to UI if you want
          await gameManager.hardRefreshPlanet(planetId);
          gameManager.emit(GameManagerEvent.PlanetUpdate);
        }
      )
      .on(ContractsAPIEvent.TxQueued, (tx: Transaction) => {
        gameManager.entityStore.onTxIntent(tx);
      })
      .on(ContractsAPIEvent.TxSubmitted, (tx: Transaction) => {
        gameManager.persistentChunkStore.onEthTxSubmit(tx);
        gameManager.onTxSubmit(tx);
      })
      .on(ContractsAPIEvent.TxConfirmed, async (tx: Transaction) => {
        if (!tx.hash) return; // this should never happen
        gameManager.persistentChunkStore.onEthTxComplete(tx.hash.toString());

        if (isUnconfirmedRevealTx(tx)) {
          await gameManager.hardRefreshPlanet(tx.intent.locationId);
        } else if (isUnconfirmedInitTx(tx)) {
          terminal.current?.println("Loading Home Planet from Blockchain...");
          const receipt = await tx.confirmedPromise;
          if (receipt.blockNumber != null) {
            await gameManager.contractsAPI.waitForBlock(receipt.blockNumber);
          }
          await gameManager.hardRefreshPlanet(tx.intent.locationId);
          // mining manager should be initialized already via joinGame, but just in case...
          gameManager.initMiningManager(tx.intent.location.coords, 4);
        } else if (isUnconfirmedMoveTx(tx)) {
          const promises = [
            gameManager.bulkHardRefreshPlanets([tx.intent.from, tx.intent.to]),
          ];
          if (tx.intent.artifact) {
            promises.push(gameManager.hardRefreshArtifact(tx.intent.artifact));
          }
          await Promise.all(promises);
        } else if (isUnconfirmedUpgradeTx(tx)) {
          await gameManager.hardRefreshPlanet(tx.intent.locationId);
        } else if (isUnconfirmedBuyHatTx(tx)) {
          await gameManager.hardRefreshPlanet(tx.intent.locationId);
        } else if (isUnconfirmedFindArtifactTx(tx)) {
          await gameManager.hardRefreshPlanet(tx.intent.planetId);
        } else if (isUnconfirmedDepositArtifactTx(tx)) {
          await Promise.all([
            gameManager.hardRefreshPlanet(tx.intent.locationId),
            gameManager.hardRefreshArtifact(tx.intent.artifactId),
          ]);
        } else if (isUnconfirmedWithdrawArtifactTx(tx)) {
          await Promise.all([
            await gameManager.hardRefreshPlanet(tx.intent.locationId),
            await gameManager.hardRefreshArtifact(tx.intent.artifactId),
          ]);
        } else if (isUnconfirmedProspectPlanetTx(tx)) {
          await gameManager.softRefreshPlanet(tx.intent.planetId);
        } else if (isUnconfirmedActivateArtifactTx(tx)) {
          await Promise.all([
            gameManager.hardRefreshPlanet(tx.intent.locationId),
            gameManager.hardRefreshArtifact(tx.intent.artifactId),
          ]);
        } else if (isUnconfirmedDeactivateArtifactTx(tx)) {
          await Promise.all([
            gameManager.hardRefreshPlanet(tx.intent.locationId),
            gameManager.hardRefreshArtifact(tx.intent.artifactId),
          ]);
        } else if (isUnconfirmedWithdrawSilverTx(tx)) {
          await gameManager.softRefreshPlanet(tx.intent.locationId);
        } else if (isUnconfirmedCapturePlanetTx(tx)) {
          await Promise.all([
            gameManager.hardRefreshPlayer(gameManager.getAccount()),
            gameManager.hardRefreshPlanet(tx.intent.locationId),
          ]);
        } else if (isUnconfirmedInvadePlanetTx(tx)) {
          await Promise.all([
            gameManager.hardRefreshPlayer(gameManager.getAccount()),
            gameManager.hardRefreshPlanet(tx.intent.locationId),
          ]);
        } else if (isUnconfirmedPauseGameTx(tx)) {
          gameManager.paused = true;
          gameManager.paused$.publish(true);
        } else if (isUnconfirmedUnpauseGameTx(tx)) {
          gameManager.paused = false;
          gameManager.paused$.publish(false);
        } else if (isUnconfirmedCreatePlanetTx(tx)) {
          gameManager.hardRefreshPlanet(tx.intent.locationId);
        } else if (isUnconfirmedSafeSetOwnerTx(tx)) {
          gameManager.hardRefreshPlanet(tx.intent.locationId);
        }

        gameManager.entityStore.clearUnconfirmedTxIntent(tx);
        gameManager.onTxConfirmed(tx);
      })
      .on(ContractsAPIEvent.TxErrored, async (tx: Transaction) => {
        gameManager.entityStore.clearUnconfirmedTxIntent(tx);
        if (tx.hash) {
          gameManager.persistentChunkStore.onEthTxComplete(tx.hash.toString());
        }
        gameManager.onTxReverted(tx);
      })
      .on(ContractsAPIEvent.TxCancelled, async (tx: Transaction) => {
        gameManager.onTxCancelled(tx);
      })
      .on(ContractsAPIEvent.RadiusUpdated, async () => {
        const newRadius = await gameManager.contractsAPI.getWorldRadius();
        gameManager.setRadius(newRadius);
      });

    const unconfirmedTxs =
      await persistentChunkStore.getUnconfirmedSubmittedEthTxs();
    const confirmationQueue = new ThrottledConcurrentQueue({
      invocationIntervalMs: 1000,
      maxInvocationsPerIntervalMs: 10,
      maxConcurrency: 1,
    });

    for (const unconfirmedTx of unconfirmedTxs) {
      confirmationQueue.add(async () => {
        const tx =
          gameManager.contractsAPI.txExecutor.waitForTransaction(unconfirmedTx);
        gameManager.contractsAPI.emitTransactionEvents(tx);
        return tx.confirmedPromise;
      });
    }

    // we only want to initialize the mining manager if the player has already joined the game
    // if they haven't, we'll do this once the player has joined the game
    if (!!homeLocation && initialState.players.has(account as string)) {
      gameManager.initMiningManager(homeLocation.coords);
    }

    return gameManager;
  }

  private async hardRefreshPlayer(address?: EthAddress): Promise<void> {
    if (!address) return;
    const playerFromBlockchain = await this.contractsAPI.getPlayerById(address);
    if (!playerFromBlockchain) return;

    const localPlayer = this.getPlayer(address);

    // if (localPlayer?.twitter) {
    //   playerFromBlockchain.twitter = localPlayer.twitter;
    // }

    this.players.set(address, playerFromBlockchain);
    this.playersUpdated$.publish();
  }

  // Dirty hack for only refreshing properties on a planet and nothing else
  private async softRefreshPlanet(planetId: LocationId): Promise<void> {
    const planet = await this.contractsAPI.getPlanetById(planetId);
    if (!planet) return;
    this.entityStore.replacePlanetFromContractData(planet);
  }

  public async hardRefreshPlanet(planetId: LocationId): Promise<void> {
    const planet = await this.contractsAPI.getPlanetById(planetId);
    if (!planet) {
      return;
    }

    const arrivals = await this.contractsAPI.getArrivalsForPlanet(planetId);
    const artifactsOnPlanets =
      await this.contractsAPI.bulkGetArtifactsOnPlanets([planetId]);
    const artifactsOnPlanet = artifactsOnPlanets[0];

    const revealedCoords =
      await this.contractsAPI.getRevealedCoordsByIdIfExists(planetId);
    let revealedLocation: RevealedLocation | undefined;
    let claimedCoords: ClaimedCoords | undefined;

    if (revealedCoords) {
      const loc = await this.locationFromCoords(revealedCoords);
      revealedLocation = {
        ...loc,
        revealer: revealedCoords.revealer,
      };
    }

    this.entityStore.replacePlanetFromContractData(
      planet,
      arrivals,
      artifactsOnPlanet.map((a) => a.id),
      revealedLocation,
      claimedCoords?.revealer
    );

    // it's important that we reload the artifacts that are on the planet after the move
    // completes because this move could have been a photoid canon move. one of the side
    // effects of this type of move is that the active photoid canon deactivates upon a move
    // meaning we need to reload its data from the blockchain.
    artifactsOnPlanet.forEach((a) =>
      this.entityStore.replaceArtifactFromContractData(a)
    );
  }

  private async bulkHardRefreshPlanets(planetIds: LocationId[]): Promise<void> {
    const planetVoyageMap: Map<LocationId, QueuedArrival[]> = new Map();

    const allVoyages = await this.contractsAPI.getAllArrivals(planetIds);
    const planetsToUpdateMap =
      await this.contractsAPI.bulkGetPlanets(planetIds);
    const artifactsOnPlanets =
      await this.contractsAPI.bulkGetArtifactsOnPlanets(planetIds);
    planetsToUpdateMap.forEach((planet, locId) => {
      if (planetsToUpdateMap.has(locId)) {
        planetVoyageMap.set(locId, []);
      }
    });

    for (const voyage of allVoyages) {
      const voyagesForToPlanet = planetVoyageMap.get(voyage.toPlanet);
      if (voyagesForToPlanet) {
        voyagesForToPlanet.push(voyage);
        planetVoyageMap.set(voyage.toPlanet, voyagesForToPlanet);
      }
    }

    for (let i = 0; i < planetIds.length; i++) {
      const planetId = planetIds[i];
      const planet = planetsToUpdateMap.get(planetId);

      // This shouldn't really happen, but we are better off being safe - opposed to throwing
      if (!planet) {
        continue;
      }

      const voyagesForPlanet = planetVoyageMap.get(planet.locationId);
      if (voyagesForPlanet) {
        this.entityStore.replacePlanetFromContractData(
          planet,
          voyagesForPlanet,
          artifactsOnPlanets[i].map((a) => a.id)
        );
      }
    }

    for (const artifacts of artifactsOnPlanets) {
      this.entityStore.replaceArtifactsFromContractData(artifacts);
    }
  }

  public async hardRefreshArtifact(artifactId: ArtifactId): Promise<void> {
    const artifact = await this.contractsAPI.getArtifactById(artifactId);
    if (!artifact) return;
    this.entityStore.replaceArtifactFromContractData(artifact);
  }

  private onTxSubmit(tx: Transaction): void {
    this.terminal.current?.print(
      `${tx.intent.methodName} transaction (`,
      TerminalTextStyle.Blue
    );
    this.terminal.current?.printLink(
      `${tx.hash != null ? String(tx.hash).slice(0, 6) : ""}`,
      () => {
        window.open(
          `${BLOCK_EXPLORER_URL}/${tx.hash != null ? String(tx.hash) : ""}`
        );
      },
      TerminalTextStyle.White
    );
    this.terminal.current?.println(`) submitted`, TerminalTextStyle.Blue);
  }

  private onTxConfirmed(tx: Transaction) {
    this.terminal.current?.print(
      `${tx.intent.methodName} transaction (`,
      TerminalTextStyle.Green
    );
    this.terminal.current?.printLink(
      `${tx.hash != null ? String(tx.hash).slice(0, 6) : ""}`,
      () => {
        window.open(
          `${BLOCK_EXPLORER_URL}/${tx.hash != null ? String(tx.hash) : ""}`
        );
      },
      TerminalTextStyle.White
    );
    this.terminal.current?.println(`) confirmed`, TerminalTextStyle.Green);
  }

  private onTxReverted(tx: Transaction) {
    this.terminal.current?.print(
      `${tx.intent.methodName} transaction (`,
      TerminalTextStyle.Red
    );
    this.terminal.current?.printLink(
      `${tx.hash != null ? String(tx.hash).slice(0, 6) : ""}`,
      () => {
        window.open(
          `${BLOCK_EXPLORER_URL}/${tx.hash != null ? String(tx.hash) : ""}`
        );
      },
      TerminalTextStyle.White
    );

    this.terminal.current?.println(`) reverted`, TerminalTextStyle.Red);
  }

  private onTxCancelled(tx: Transaction) {
    this.entityStore.clearUnconfirmedTxIntent(tx);
    this.terminal.current?.print(
      `${tx.intent.methodName} transaction (`,
      TerminalTextStyle.Red
    );
    this.terminal.current?.printLink(
      `${tx.hash != null ? String(tx.hash).slice(0, 6) : ""}`,
      () => {
        window.open(
          `${BLOCK_EXPLORER_URL}/${tx.hash != null ? String(tx.hash) : ""}`
        );
      },
      TerminalTextStyle.White
    );

    this.terminal.current?.println(`) cancelled`, TerminalTextStyle.Red);
  }

  /**
   * Gets the address of the player logged into this game manager.
   */
  public getAccount(): EthAddress | undefined {
    return this.account;
  }

  /**
   * Get the thing that handles contract interaction.
   */
  public getContractAPI(): ContractsAPI {
    return this.contractsAPI;
  }

  /**
   * Gets the address of the `DarkForest` contract, which is the 'backend' of the game.
   */
  public getContractAddress(): EthAddress {
    return this.contractsAPI.getContractAddress();
  }

  // /**
  //  * Gets the twitter handle of the given ethereum account which is associated
  //  * with Dark Forest.
  //  */
  // public getTwitter(address: EthAddress | undefined): string | undefined {
  //   let myAddress;
  //   if (!address) myAddress = this.getAccount();
  //   else myAddress = address;

  //   if (!myAddress) {
  //     return undefined;
  //   }
  //   const twitter = this.players.get(myAddress)?.twitter;
  //   return twitter;
  // }

  /**
   * The game ends at a particular time in the future - get this time measured
   * in seconds from the epoch.
   */
  public getEndTimeSeconds(): number {
    return this.endTimeSeconds;
  }

  /**
   * Dark Forest tokens can only be minted up to a certain time - get this time measured in seconds from epoch.
   */
  public getTokenMintEndTimeSeconds(): number {
    return this.contractConstants.TOKEN_MINT_END_SECONDS;
  }

  /**
   * Gets the rarity of planets in the universe
   */
  public getPlanetRarity(): number {
    return this.contractConstants.PLANET_RARITY;
  }

  /**
   * returns timestamp (seconds) that planet will reach percent% of energycap
   * time may be in the past
   */
  public getEnergyCurveAtPercent(planet: Planet, percent: number): number {
    return this.entityStore.getEnergyCurveAtPercent(planet, percent);
  }

  /**
   * returns timestamp (seconds) that planet will reach percent% of silcap if
   * doesn't produce silver, returns undefined if already over percent% of silcap,
   */
  public getSilverCurveAtPercent(
    planet: Planet,
    percent: number
  ): number | undefined {
    return this.entityStore.getSilverCurveAtPercent(planet, percent);
  }

  /**
   * Returns the upgrade that would be applied to a planet given a particular
   * upgrade branch (defense, range, speed) and level of upgrade.
   */
  public getUpgrade(branch: number, level: number): Upgrade {
    return this.contractConstants.upgrades[branch][level];
  }

  /**
   * Gets a list of all the players in the game (not just the ones you've
   * encounterd)
   */
  public getAllPlayers(): Player[] {
    return Array.from(this.players.values());
  }

  /**
   * Gets either the given player, or if no address was provided, gets the player that is logged
   * this client.
   */
  public getPlayer(address?: EthAddress): Player | undefined {
    address = address || this.account;

    if (!address) {
      return undefined;
    }

    return this.players.get(address);
  }

  /**
   * Gets all the map chunks that this client is aware of. Chunks may have come from
   * mining, or from importing map data.
   */
  public getExploredChunks(): Iterable<Chunk> {
    return this.persistentChunkStore.allChunks();
  }

  /**
   * Gets the ids of all the planets that are both within the given bounding box (defined by its bottom
   * left coordinate, width, and height) in the world and of a level that was passed in via the
   * `planetLevels` parameter.
   */
  public getPlanetsInWorldRectangle(
    worldX: number,
    worldY: number,
    worldWidth: number,
    worldHeight: number,
    levels: number[],
    planetLevelToRadii: Map<number, Radii>,
    updateIfStale = true
  ): LocatablePlanet[] {
    return this.entityStore.getPlanetsInWorldRectangle(
      worldX,
      worldY,
      worldWidth,
      worldHeight,
      levels,
      planetLevelToRadii,
      updateIfStale
    );
  }

  public getChainTimeMs(): number {
    return this.chainClock.now();
  }

  /**
   * Returns whether or not the current round has ended.
   */
  public isRoundOver(): boolean {
    return this.chainClock.nowSec() > this.getTokenMintEndTimeSeconds();
  }

  /**
   * Gets the radius of the playable area of the universe.
   */
  public getWorldRadius(): number {
    return this.worldRadius;
  }

  /**
   * Gets the total amount of silver that lives on a planet that somebody owns.
   */
  public getWorldSilver(): number {
    return this.getAllOwnedPlanets().reduce(
      (totalSoFar: number, nextPlanet: Planet) =>
        totalSoFar + nextPlanet.silver,
      0
    );
  }

  /**
   * Gets the total amount of energy that lives on a planet that somebody owns.
   */
  public getUniverseTotalEnergy(): number {
    return this.getAllOwnedPlanets().reduce(
      (totalSoFar: number, nextPlanet: Planet) =>
        totalSoFar + nextPlanet.energy,
      0
    );
  }

  /**
   * Gets the total amount of silver that lives on planets that the given player owns.
   */
  public getSilverOfPlayer(player: EthAddress): number {
    return this.getAllOwnedPlanets()
      .filter((planet) => planet.owner === player)
      .reduce(
        (totalSoFar: number, nextPlanet: Planet) =>
          totalSoFar + nextPlanet.silver,
        0
      );
  }

  /**
   * Gets the total amount of energy that lives on planets that the given player owns.
   */
  public getEnergyOfPlayer(player: EthAddress): number {
    return this.getAllOwnedPlanets()
      .filter((planet) => planet.owner === player)
      .reduce(
        (totalSoFar: number, nextPlanet: Planet) =>
          totalSoFar + nextPlanet.energy,
        0
      );
  }

  public getPlayerScore(addr: EthAddress): number | undefined {
    const player = this.players.get(addr);
    return player?.score;
  }

  public getPlayerSpaceJunk(addr: EthAddress): number | undefined {
    const player = this.players.get(addr);
    return player?.spaceJunk;
  }

  public getPlayerSpaceJunkLimit(addr: EthAddress): number | undefined {
    const player = this.players.get(addr);
    return player?.spaceJunkLimit;
  }

  public getDefaultSpaceJunkForPlanetLevel(level: number) {
    return this.contractConstants.PLANET_LEVEL_JUNK[level];
  }

  private initMiningManager(homeCoords: WorldCoords, cores?: number): void {
    if (this.minerManager) return;

    const myPattern: MiningPattern = new SpiralPattern(
      homeCoords,
      MIN_CHUNK_SIZE
    );

    this.minerManager = MinerManager.create(
      this.persistentChunkStore,
      myPattern,
      this.worldRadius,
      this.planetRarity,
      this.hashConfig,
      this.useMockHash
    );

    const config = {
      contractAddress: this.getContractAddress(),
      account: this.account,
    };

    this.minerManager.setCores(
      cores || getNumberSetting(config, Setting.MiningCores)
    );

    this.minerManager.on(
      MinerManagerEvent.DiscoveredNewChunk,
      (chunk: Chunk, miningTimeMillis: number) => {
        this.addNewChunk(chunk);
        this.hashRate =
          chunk.chunkFootprint.sideLength ** 2 / (miningTimeMillis / 1000);
        this.emit(GameManagerEvent.DiscoveredNewChunk, chunk);
      }
    );

    const isMining = getBooleanSetting(config, Setting.IsMining);
    if (isMining) {
      this.minerManager.startExplore();
    }
  }

  /**
   * Sets the mining pattern of the miner. This kills the old miner and starts this one.
   */
  setMiningPattern(pattern: MiningPattern): void {
    if (this.minerManager) {
      this.minerManager.setMiningPattern(pattern);
    }
  }

  /**
   * Gets the mining pattern that the miner is currently using.
   */
  getMiningPattern(): MiningPattern | undefined {
    if (this.minerManager) return this.minerManager.getMiningPattern();
    else return undefined;
  }

  /**
   * Set the amount of cores to mine the universe with. More cores equals faster!
   */
  setMinerCores(nCores: number): void {
    const config = {
      contractAddress: this.getContractAddress(),
      account: this.account,
    };
    setSetting(config, Setting.MiningCores, nCores + "");
  }

  /**
   * Whether or not the miner is currently exploring space.
   */
  isMining(): boolean {
    return this.minerManager?.isMining() || false;
  }

  /**
   * Gets the rectangle bounding the chunk that the miner is currently in the process
   * of hashing.
   */
  getCurrentlyExploringChunk(): Rectangle | undefined {
    if (this.minerManager) {
      return this.minerManager.getCurrentlyExploringChunk();
    }
    return undefined;
  }

  /**
   * Whether or not this client has successfully found and landed on a home planet.
   */
  hasJoinedGame(): boolean {
    return this.players.has(this.account as string);
  }

  /**
   * Returns info about the next time you can broadcast coordinates
   */
  getNextRevealCountdownInfo(): RevealCountdownInfo {
    if (!this.account) {
      throw new Error("no account set");
    }
    const myLastRevealTimestamp = this.players.get(
      this.account
    )?.lastRevealTimestamp;
    return {
      myLastRevealTimestamp: myLastRevealTimestamp || undefined,
      currentlyRevealing: this.entityStore.transactions.hasTransaction(
        isUnconfirmedRevealTx
      ),
      revealCooldownTime: this.contractConstants.LOCATION_REVEAL_COOLDOWN,
    };
  }

  /**
   * gets both deposited artifacts that are on planets i own as well as artifacts i own
   */
  getMyArtifacts(): Artifact[] {
    if (!this.account) return [];
    const ownedByMe = this.entityStore.getArtifactsOwnedBy(this.account);
    const onPlanetsOwnedByMe = this.entityStore
      .getArtifactsOnPlanetsOwnedBy(this.account)
      // filter out space ships because they always show up
      // in the `ownedByMe` array.
      .filter((a) => !isSpaceShip(a.artifactType));

    return [...ownedByMe, ...onPlanetsOwnedByMe];
  }

  /**
   * Gets the planet that is located at the given coordinates. Returns undefined if not a valid
   * location or if no planet exists at location. If the planet needs to be updated (because
   * some time has passed since we last updated the planet), then updates that planet first.
   */
  getPlanetWithCoords(coords: WorldCoords): LocatablePlanet | undefined {
    return this.entityStore.getPlanetWithCoords(coords);
  }

  /**
   * Gets the planet with the given hash. Returns undefined if the planet is neither in the contract
   * nor has been discovered locally. If the planet needs to be updated (because some time has
   * passed since we last updated the planet), then updates that planet first.
   */
  getPlanetWithId(planetId: LocationId | undefined): Planet | undefined {
    return planetId && this.entityStore.getPlanetWithId(planetId);
  }

  /**
   * Gets a list of planets in the client's memory with the given ids. If a planet with the given id
   * doesn't exist, no entry for that planet will be returned in the result.
   */
  getPlanetsWithIds(planetId: LocationId[]): Planet[] {
    return planetId
      .map((id) => this.getPlanetWithId(id))
      .filter((p) => !!p) as Planet[];
  }

  getStalePlanetWithId(planetId: LocationId): Planet | undefined {
    return this.entityStore.getPlanetWithId(planetId, false);
  }

  async debugPlanet(planetId: LocationId): Promise<void> {
    const stalePlanet = this.entityStore.getPlanetWithId(planetId, false);
    if (!stalePlanet) {
      console.warn(`[debugPlanet] Planet not found: ${planetId}`);
      return;
    }

    const decId = locationIdToDecStr(planetId);
    const allArrivals = await this.contractsAPI.getArrivalsForPlanet(planetId);
    const nowSec = Math.floor(this.chainClock.nowSec());

    const chainRaw = this.contractsAPI.indexerConnection.getPlanet(decId);
    const precision = CONTRACT_PRECISION;
    const chainCreatedAt = chainRaw ? Number(chainRaw.created_at) : 0;
    const chainLastUpdated = chainRaw ? Number(chainRaw.last_updated) : 0;
    const chainEnergy = chainRaw ? Number(chainRaw.population) / precision : 0;
    const isHome = chainRaw?.is_home_planet ?? stalePlanet.isHomePlanet;

    const planetEvents =
      this.contractsAPI.indexerConnection.getPlanetEvents(decId);
    const pendingIds = new Set<string>();
    if (planetEvents) {
      for (let i = 0; i < planetEvents.count; i++) {
        pendingIds.add(planetEvents.events[i].id);
      }
    }

    // Initial energy at creation
    const initialEnergy = isHome ? 50000 / precision : stalePlanet.energy;
    // For non-home planets the default barbarian energy is baked into the
    // decoded stalePlanet.energy when the planet hasn't been touched yet.
    // If the planet HAS been touched, we recalculate from contract defaults.
    const defaultInitialEnergy = isHome
      ? 50000 / precision
      : (() => {
          const lvl = stalePlanet.planetLevel;
          const cc = this.contractConstants;
          let cap = cc.defaultPopulationCap[lvl];
          const st = stalePlanet.spaceType;
          if (st === SpaceType.DEAD_SPACE) cap *= 20;
          else if (st === SpaceType.DEEP_SPACE) cap *= 10;
          else if (st === SpaceType.SPACE) cap *= 4;
          let pirates = (cap * cc.defaultBarbarianPercentage[lvl]) / 100;
          if (stalePlanet.planetType === PlanetType.SILVER_BANK) pirates /= 2;
          return pirates;
        })();

    // Arrivals targeting this planet, sorted by arrivalTime
    const inbound = allArrivals
      .filter((a) => a.toPlanet === planetId)
      .sort((a, b) => a.arrivalTime - b.arrivalTime);

    // Build timeline
    type TimelineRow = {
      time: number;
      dt: string;
      event: string;
      detail: string;
      energyBefore: string;
      energyAfter: string;
      owner: string;
    };

    const rows: TimelineRow[] = [];
    let simEnergy = defaultInitialEnergy;
    let simLastUpdated = chainCreatedAt;
    let simOwner = isHome ? (stalePlanet.owner ?? "player") : "(nobody)";
    const { energyCap, energyGrowth, defense } = stalePlanet;

    const grow = (toSec: number) => {
      if (stalePlanet.pausers > 0) return;
      const dt = toSec - simLastUpdated;
      if (dt > 0 && simOwner !== "(nobody)") {
        simEnergy = Math.min(simEnergy + energyGrowth * dt, energyCap);
      }
      simLastUpdated = toSec;
    };

    // 1) Planet creation
    rows.push({
      time: chainCreatedAt,
      dt: "—",
      event: "CREATED",
      detail: isHome ? "home planet" : "initialized by first move",
      energyBefore: "—",
      energyAfter: simEnergy.toFixed(1),
      owner: simOwner,
    });

    // 2) All inbound arrivals
    for (const a of inbound) {
      const isPending = pendingIds.has(a.eventId);
      const energyBefore = simEnergy;
      grow(a.arrivalTime);
      const energyAfterGrowth = simEnergy;

      const isFriendly = a.player === simOwner;
      if (isFriendly) {
        simEnergy = Math.min(simEnergy + a.energyArriving, energyCap);
      } else {
        const effectiveAttack = (a.energyArriving * 100) / defense;
        if (simEnergy > effectiveAttack) {
          simEnergy -= effectiveAttack;
        } else {
          simOwner = a.player;
          simEnergy = a.energyArriving - (energyAfterGrowth * defense) / 100;
          if (simEnergy <= 0) simEnergy = 1;
        }
      }

      const delta = a.arrivalTime - nowSec;
      const tag = isPending
        ? delta > 0
          ? `PENDING (in ${delta}s)`
          : "PENDING (matured)"
        : "SETTLED";

      rows.push({
        time: a.arrivalTime,
        dt: `+${a.arrivalTime - chainCreatedAt}s`,
        event: `${tag} | ${isFriendly ? "friendly" : "hostile"}`,
        detail:
          `e=${a.energyArriving.toFixed(1)} s=${a.silverMoved.toFixed(1)}` +
          ` from=${a.fromPlanet.slice(0, 8)}… [${a.eventId}]`,
        energyBefore: energyBefore.toFixed(1),
        energyAfter: simEnergy.toFixed(1),
        owner: simOwner.slice(0, 10) + "…",
      });
    }

    // 3) NOW marker
    grow(nowSec);
    rows.push({
      time: nowSec,
      dt: `+${nowSec - chainCreatedAt}s`,
      event: ">>> NOW <<<",
      detail: "",
      energyBefore: "—",
      energyAfter: simEnergy.toFixed(1),
      owner: simOwner.slice(0, 10) + "…",
    });

    console.group(`[debugPlanet] ${planetId}`);

    console.group("Planet Info");
    console.log("planetLevel:", stalePlanet.planetLevel);
    console.log("planetType:", stalePlanet.planetType);
    console.log("spaceType:", stalePlanet.spaceType);
    console.log("isHomePlanet:", isHome);
    console.log("energyCap:", energyCap, "energyGrowth:", energyGrowth);
    console.log("defense:", defense);
    console.log("chain created_at:", chainCreatedAt);
    console.log("chain last_updated:", chainLastUpdated);
    console.log("chain energy:", chainEnergy);
    console.log("client lastUpdated:", stalePlanet.lastUpdated);
    console.log("client energy:", stalePlanet.energy);
    console.log("simulated initial energy:", defaultInitialEnergy);
    console.groupEnd();

    console.group("Arrivals Summary");
    console.log("total arrivals in indexer:", allArrivals.length);
    console.log("inbound (toPlanet):", inbound.length);
    console.log("pending (in PlanetEvents):", pendingIds.size);
    console.log(
      "settled:",
      inbound.filter((a) => !pendingIds.has(a.eventId)).length
    );
    console.groupEnd();

    console.group(`Timeline (${rows.length} events)`);
    console.table(rows);
    console.groupEnd();

    console.group("Verification");
    console.log("simulated energy at NOW:", simEnergy.toFixed(1));
    console.log("chain energy at last_updated:", chainEnergy.toFixed(1));
    console.log(
      "match?",
      Math.abs(simEnergy - chainEnergy) < 1 ? "YES" : "NO (drift)"
    );
    console.groupEnd();

    console.groupEnd();
  }

  /**
   * Get the score of the currently logged-in account.
   */
  getMyScore(): number | undefined {
    if (!this.account) {
      return undefined;
    }
    const player = this.players.get(this.account);
    return player?.score;
  }

  /**
   * Gets the artifact with the given id. Null if no artifact with id exists.
   */
  getArtifactWithId(artifactId?: ArtifactId): Artifact | undefined {
    return this.entityStore.getArtifactById(artifactId);
  }

  /**
   * Gets the artifacts with the given ids, including ones we know exist but haven't been loaded,
   * represented by `undefined`.
   */
  getArtifactsWithIds(
    artifactIds: ArtifactId[] = []
  ): Array<Artifact | undefined> {
    return artifactIds.map((id) => this.getArtifactWithId(id));
  }

  /**
   * Gets the level of the given planet. Returns undefined if the planet does not exist. Does
   * NOT update the planet if the planet is stale, which means this function is fast.
   */
  getPlanetLevel(planetId: LocationId): PlanetLevel | undefined {
    return this.entityStore.getPlanetLevel(planetId);
  }

  /**
   * Gets the location of the given planet. Returns undefined if the planet does not exist, or if
   * we do not know the location of this planet NOT update the planet if the planet is stale,
   * which means this function is fast.
   */
  getLocationOfPlanet(planetId: LocationId): WorldLocation | undefined {
    return this.entityStore.getLocationOfPlanet(planetId);
  }

  /**
   * Gets all voyages that have not completed.
   */
  getAllVoyages(): QueuedArrival[] {
    return this.entityStore.getAllVoyages();
  }

  /**
   * Gets all planets. This means all planets that are in the contract, and also all
   * planets that have been mined locally. Does not update planets if they are stale.
   * NOT PERFORMANT - for scripting only.
   */
  getAllPlanets(): Iterable<Planet> {
    return this.entityStore.getAllPlanets();
  }

  /**
   * Gets a list of planets that have an owner.
   */
  getAllOwnedPlanets(): Planet[] {
    return this.entityStore.getAllOwnedPlanets();
  }

  /**
   * Gets a list of the planets that the player logged into this `GameManager` owns.
   */
  getMyPlanets(): Planet[] {
    return this.getAllOwnedPlanets().filter(
      (planet) => planet.owner === this.account
    );
  }

  /**
   * Gets a map of all location IDs whose coords have been publically revealed
   */
  getRevealedLocations(): Map<LocationId, RevealedLocation> {
    return this.entityStore.getRevealedLocations();
  }

  /**
   * Gets a map of all location IDs which have been claimed.
   */
  getClaimedLocations(): Map<LocationId, ClaimedLocation> {
    return this.entityStore.getClaimedLocations();
  }

  /**
   * Each coordinate lives in a particular type of space, determined by a smooth random
   * function called 'perlin noise.
   */
  spaceTypeFromPerlin(perlin: number): SpaceType {
    return this.entityStore.spaceTypeFromPerlin(perlin);
  }

  /**
   * Gets the amount of hashes per second that the miner manager is calculating.
   */
  getHashesPerSec(): number {
    return this.hashRate;
  }

  /**
   * Signs the given twitter handle with the private key of the current user. Used to
   * verify that the person who owns the Dark Forest account was the one that attempted
   * to link a twitter to their account.
   */
  async getSignedTwitter(_twitter: string): Promise<string> {
    // Aztec wallet does not expose signMessage; use different auth flow for twitter linking.
    throw new Error(
      "Twitter signing not implemented for Aztec; use alternative auth."
    );
  }

  /**
   * Gets the secret key of the active Aztec ECDSAR account.
   */
  getPrivateKey(): string | undefined {
    return this.contractsAPI.getWalletManager().getActiveAccountRecord()
      ?.secretKey;
  }

  /**
   * Returns the full credential triple (secretKey, salt, signingKey) needed
   * to recover/import the active Aztec ECDSAR account.
   */
  getAccountCredentials():
    | { secretKey: string; salt: string; signingKey: string }
    | undefined {
    const record = this.contractsAPI
      .getWalletManager()
      .getActiveAccountRecord();
    if (!record) return undefined;
    return {
      secretKey: record.secretKey,
      salt: record.salt,
      signingKey: record.signingKey,
    };
  }

  /**
   * Gets the balance of the account measured in Eth (i.e. in full units of the chain).
   */
  getMyBalanceEth(): number {
    if (!this.account) return 0;
    return weiToEth(this.getMyBalance());
  }

  /**
   * Gets the balance of the account (from WalletManager; FeeJuice on Aztec).
   */
  getMyBalance(): bigint {
    return this.contractsAPI.getWalletManager().getLastBalance();
  }

  /**
   * Returns the monomitter which publishes events whenever the player's balance changes.
   */
  getMyBalance$(): Monomitter<bigint> {
    return this.contractsAPI.getWalletManager().myBalance$;
  }

  /**
   * Gets all moves that this client has queued to be uploaded to the contract, but
   * have not been successfully confirmed yet.
   */
  getUnconfirmedMoves(): Transaction<UnconfirmedMove>[] {
    return this.entityStore.transactions.getTransactions(isUnconfirmedMoveTx);
  }

  /**
   * Gets all upgrades that this client has queued to be uploaded to the contract, but
   * have not been successfully confirmed yet.
   */
  getUnconfirmedUpgrades(): Transaction<UnconfirmedUpgrade>[] {
    return this.entityStore.transactions.getTransactions(
      isUnconfirmedUpgradeTx
    );
  }

  getUnconfirmedWormholeActivations(): Transaction<UnconfirmedActivateArtifact>[] {
    return this.entityStore.transactions
      .getTransactions(isUnconfirmedActivateArtifactTx)
      .filter((tx) => tx.intent.wormholeTo !== undefined);
  }

  /**
   * Gets the location of your home planet.
   */
  getHomeCoords(): WorldCoords | undefined {
    if (!this.homeLocation) return undefined;
    return {
      x: this.homeLocation.coords.x,
      y: this.homeLocation.coords.y,
    };
  }

  /**
   * Gets the hash of the location of your home planet.
   */
  getHomeHash(): LocationId | undefined {
    return this.homeLocation?.hash;
  }

  /**
   * Gets the HASH CONFIG
   */
  getHashConfig(): HashConfig {
    return { ...this.hashConfig };
  }

  /**
   * Whether or not the given rectangle has been mined.
   */
  hasMinedChunk(chunkLocation: Rectangle): boolean {
    return this.persistentChunkStore.hasMinedChunk(chunkLocation);
  }

  getChunk(chunkFootprint: Rectangle): Chunk | undefined {
    return this.persistentChunkStore.getChunkByFootprint(chunkFootprint);
  }

  getChunkStore(): PersistentChunkStore {
    return this.persistentChunkStore;
  }

  /**
   * The perlin value at each coordinate determines the space type. There are four space
   * types, which means there are four ranges on the number line that correspond to
   * each space type. This function returns the boundary values between each of these
   * four ranges: `PERLIN_THRESHOLD_1`, `PERLIN_THRESHOLD_2`, `PERLIN_THRESHOLD_3`.
   */
  getPerlinThresholds(): [number, number, number] {
    return [
      this.contractConstants.PERLIN_THRESHOLD_1,
      this.contractConstants.PERLIN_THRESHOLD_2,
      this.contractConstants.PERLIN_THRESHOLD_3,
    ];
  }

  /**
   * Starts the miner.
   */
  startExplore(): void {
    if (this.minerManager) {
      const config = {
        contractAddress: this.getContractAddress(),
        account: this.account,
      };
      setBooleanSetting(config, Setting.IsMining, true);
      this.minerManager.startExplore();
    }
  }

  /**
   * Stops the miner.
   */
  stopExplore(): void {
    if (this.minerManager) {
      const config = {
        contractAddress: this.getContractAddress(),
        account: this.account,
      };
      setBooleanSetting(config, Setting.IsMining, false);
      this.hashRate = 0;
      this.minerManager.stopExplore();
    }
  }

  private setRadius(worldRadius: number) {
    this.worldRadius = worldRadius;

    if (this.minerManager) {
      this.minerManager.setRadius(this.worldRadius);
    }
  }

  // private async refreshTwitters(): Promise<void> {
  //   const addressTwitters = await getAllTwitters();
  //   this.setPlayerTwitters(addressTwitters);
  // }

  // private setPlayerTwitters(twitters: AddressTwitterMap): void {
  //   for (const [address, player] of this.players.entries()) {
  //     const newPlayerTwitter = twitters[address];
  //     player.twitter = newPlayerTwitter;
  //   }
  //   this.playersUpdated$.publish();
  // }

  /**
   * Once you have posted the verification tweet - complete the twitter-account-linking
   * process by telling the Dark Forest webserver to look at that tweet.
   */
  // async submitVerifyTwitter(twitter: string): Promise<boolean> {
  //   if (!this.account) return Promise.resolve(false);
  //   const success = await verifyTwitterHandle(
  //     await this.ethConnection.signMessageObject({ twitter })
  //   );
  //   await this.refreshTwitters();
  //   return success;
  // }

  private checkGameHasEnded(): boolean {
    if (this.chainClock.nowSec() > this.endTimeSeconds) {
      this.terminal.current?.println("[ERROR] Game has ended.");
      return true;
    }
    return false;
  }

  /**
   * Gets the timestamp (ms) of the next time that we can broadcast the coordinates of a planet.
   */
  public getNextBroadcastAvailableTimestamp() {
    return this.chainClock.now() + this.timeUntilNextBroadcastAvailable();
  }

  /**
   * Gets the amount of time (ms) until the next time the current player can broadcast a planet.
   */
  public timeUntilNextBroadcastAvailable() {
    if (!this.account) {
      throw new Error("no account set");
    }

    const myLastRevealTimestamp = this.players.get(
      this.account
    )?.lastRevealTimestamp;

    return timeUntilNextBroadcastAvailable(
      myLastRevealTimestamp,
      this.contractConstants.LOCATION_REVEAL_COOLDOWN
    );
  }

  // public getCaptureZones(): Set<CaptureZone> {
  //   return this.captureZoneGenerator?.getZones() || new Set();
  // }

  /**
   * Reveals a planet's location on-chain.
   */
  public async revealLocation(
    planetId: LocationId
  ): Promise<Transaction<UnconfirmedReveal>> {
    try {
      if (!this.account) {
        throw new Error("no account set");
      }

      const planet = this.entityStore.getPlanetWithId(planetId);

      if (!planet) {
        throw new Error("you can't reveal a planet you haven't discovered");
      }

      if (!isLocatable(planet)) {
        throw new Error(
          "you can't reveal a planet whose coordinates you don't know"
        );
      }

      if (planet.coordsRevealed) {
        throw new Error("this planet's location is already revealed");
      }

      if (planet.transactions?.hasTransaction(isUnconfirmedRevealTx)) {
        throw new Error("you're already revealing this planet's location");
      }

      if (this.entityStore.transactions.hasTransaction(isUnconfirmedRevealTx)) {
        throw new Error("you're already broadcasting coordinates");
      }

      if (!this.isAdmin()) {
        const myLastRevealTimestamp = this.players.get(
          this.account
        )?.lastRevealTimestamp;
        if (
          myLastRevealTimestamp &&
          Date.now() < this.getNextBroadcastAvailableTimestamp()
        ) {
          throw new Error("still on cooldown for broadcasting");
        }
      }

      // this is shitty. used for the popup window
      localStorage.setItem(
        `${this.getAccount()?.toLowerCase()}-revealLocationId`,
        planetId
      );
      const getArgs = async (): Promise<unknown[]> => {
        return [planetId, planet.location.coords.x, planet.location.coords.y];
      };

      const txIntent: UnconfirmedReveal = {
        methodName: "revealLocation",
        // contract: this.contractsAPI.contract,
        locationId: planetId,
        location: planet.location,
        args: getArgs(),
      };

      // Always await the submitTransaction so we can catch rejections
      const tx = await this.contractsAPI.submitTransaction(txIntent);

      return tx;
    } catch (e) {
      this.getNotificationsManager().txInitError(
        "revealLocation",
        e instanceof Error ? e.message : String(e)
      );
      throw e;
    }
  }

  /**
   * Attempts to join the game. Should not be called once you've already joined.
   */
  public async joinGame(
    beforeRetry: (e: Error) => Promise<boolean>
  ): Promise<void> {
    try {
      if (this.checkGameHasEnded()) {
        throw new Error("game has ended");
      }

      const planet = await this.findRandomHomePlanet();
      this.homeLocation = planet.location;
      this.terminal.current?.println("");
      this.terminal.current?.println(
        `Found Suitable Home Planet: ${getPlanetName(planet)} `
      );
      this.terminal.current?.println(
        `Its coordinates are: (${planet.location.coords.x}, ${planet.location.coords.y})`
      );
      this.terminal.current?.println("");

      await this.persistentChunkStore.addHomeLocation(planet.location);

      const getArgs = async (): Promise<unknown[]> => {
        const x = planet.location.coords.x;
        const y = planet.location.coords.y;
        const radius = Math.floor(Math.sqrt(x * x + y * y)) + 1;
        const locationId = planet.location.hash;
        const perlin = planet.location.perlin;
        const level = planet.planetLevel;
        const args: unknown[] = [x, y, radius, locationId, perlin, level];
        this.terminal.current?.println(
          "INIT: args [x, y, radius, locationId, perlin, level]:",
          TerminalTextStyle.Sub
        );
        this.terminal.current?.println(
          JSON.stringify(args.slice(0, 4)),
          TerminalTextStyle.Sub
        );
        this.terminal.current?.newline();
        return args;
      };

      const txIntent: UnconfirmedInit = {
        methodName: "initializePlayer",
        locationId: planet.location.hash,
        location: planet.location,
        args: getArgs(),
        uiTimestamp: Math.floor(this.chainClock.nowSec()),
      };

      this.terminal.current?.println(
        "INIT: proving that planet exists",
        TerminalTextStyle.Sub
      );

      this.initMiningManager(planet.location.coords); // get an early start

      // if player initialization causes an error, give the caller an opportunity
      // to resolve that error. if the asynchronous `beforeRetry` function returns
      // true, retry initializing the player. if it returns false, or if the
      // `beforeRetry` is undefined, then don't retry and throw an exception.
      while (true) {
        try {
          const tx = await this.contractsAPI.submitTransaction(txIntent);
          const receipt = await tx.confirmedPromise;

          // Wait for the indexer to process the block containing this tx
          // before refreshing planet state, otherwise we get stale data.
          if (receipt.blockNumber != null) {
            await this.contractsAPI.waitForBlock(receipt.blockNumber);
          }

          break;
        } catch (e) {
          if (beforeRetry) {
            if (await beforeRetry(e)) {
              continue;
            }
          } else {
            throw e;
          }
        }
      }

      await this.getSpaceships();
      await this.hardRefreshPlanet(planet.locationId);

      this.emit(GameManagerEvent.InitializedPlayer);
    } catch (e) {
      this.getNotificationsManager().txInitError("initializePlayer", e.message);
      throw e;
    }
  }

  private async getSpaceships() {
    if (!this.account || !this.homeLocation?.hash) return;
    if (
      !Object.values(this.contractConstants.SPACESHIPS).some((a) => a === true)
    ) {
      console.log("all spaceships disabled, not calling the tx");
      return;
    }

    const player = await this.contractsAPI.getPlayerById(this.account);
    if (player?.claimedShips) return;

    if (this.getGameObjects().isGettingSpaceships()) return;
    const tx = await this.contractsAPI.submitTransaction({
      methodName: "giveSpaceShips",
      args: Promise.resolve(["0x" + this.homeLocation?.hash]),
    });
    await tx.confirmedPromise;
    this.hardRefreshPlanet(this.homeLocation?.hash);
  }

  // this is slow, do not call in i.e. render/draw loop
  /**
   * Computes the WorldLocation for given coordinates (uses Poseidon2 / fakeHash).
   * Slow; do not use in render loop.
   */
  private async locationFromCoords(
    coords: WorldCoords
  ): Promise<WorldLocation> {
    const hash = await this.planetHashAt(coords.x, coords.y);
    return {
      coords,
      hash: locationIdFromBigInt(hash),
      perlin: this.spaceTypePerlin(coords, true),
      biomebase: this.biomebasePerlin(coords, true),
    };
  }

  /**
   * Initializes a new player's game to start at the given home planet. Must have already
   * initialized the player on the contract.
   */
  async addAccount(coords: WorldCoords): Promise<boolean> {
    const loc: WorldLocation = await this.locationFromCoords(coords);
    await this.persistentChunkStore.addHomeLocation(loc);
    this.initMiningManager(coords);
    this.homeLocation = loc;
    return true;
  }

  private findRandomHomePlanet(): Promise<LocatablePlanet> {
    const initPerlinMin = this.contractConstants.INIT_PERLIN_MIN;
    const initPerlinMax = this.contractConstants.INIT_PERLIN_MAX;

    // if this.contractConstants.SPAWN_RIM_AREA is non-zero, then players must spawn in that
    // area, distributed evenly in the inner perimeter of the world
    let spawnInnerRadius = Math.sqrt(
      Math.max(
        Math.PI * this.worldRadius ** 2 - this.contractConstants.SPAWN_RIM_AREA,
        0
      ) / Math.PI
    );

    if (this.contractConstants.SPAWN_RIM_AREA === 0) {
      spawnInnerRadius = 0;
    }

    return new Promise<LocatablePlanet>((resolve, reject) => {
      let x: number;
      let y: number;
      let d: number;
      let p: number;
      do {
        // sample from square
        x = Math.random() * this.worldRadius * 2 - this.worldRadius;
        y = Math.random() * this.worldRadius * 2 - this.worldRadius;
        d = Math.sqrt(x ** 2 + y ** 2);
        p = this.spaceTypePerlin({ x, y }, false);
      } while (
        p >= initPerlinMax || // keep searching if above or equal to the max
        p < initPerlinMin || // keep searching if below the minimum
        d >= this.worldRadius || // can't be out of bound
        d <= spawnInnerRadius // can't be inside spawn area ring
      );

      let minedChunksCount = 0;

      // when setting up a new account in development mode, you can tell
      // the game where to start searching for planets using this query
      // string parameter. for example:
      //
      // ?searchCenter=2866,5627
      //

      const params = new URLSearchParams(window.location.search);

      if (params.has("searchCenter")) {
        const parts = params.get("searchCenter")?.split(",");

        if (parts) {
          x = parseInt(parts[0], 10);
          y = parseInt(parts[1], 10);
        }
      }

      const pattern: MiningPattern = new SpiralPattern(
        { x, y },
        MIN_CHUNK_SIZE
      );
      const chunkStore = new HomePlanetMinerChunkStore(
        initPerlinMin,
        initPerlinMax,
        this.hashConfig
      );
      const homePlanetFinder = MinerManager.create(
        chunkStore,
        pattern,
        this.worldRadius,
        this.planetRarity,
        this.hashConfig,
        this.useMockHash
      );

      this.terminal.current?.println(``);
      this.terminal.current?.println(`Initializing Home Planet Search...`);
      this.terminal.current?.println(``);
      this.terminal.current?.println(`Chunked explorer: start!`);
      this.terminal.current?.println(
        `Each chunk contains ${MIN_CHUNK_SIZE}x${MIN_CHUNK_SIZE} coordinates.`
      );
      const percentSpawn = (1 / this.contractConstants.PLANET_RARITY) * 100;
      const printProgress = 8;
      this.terminal.current?.print(`Each coordinate has a`);
      this.terminal.current?.print(` ${percentSpawn}%`, TerminalTextStyle.Text);
      this.terminal.current?.print(` chance of spawning a planet.`);
      this.terminal.current?.println("");

      this.terminal.current?.println(
        `Hashing first ${MIN_CHUNK_SIZE ** 2 * printProgress} potential home planets...`
      );

      homePlanetFinder.on(
        MinerManagerEvent.DiscoveredNewChunk,
        (chunk: Chunk) => {
          chunkStore.addChunk(chunk);
          minedChunksCount++;
          if (minedChunksCount % printProgress === 0) {
            this.terminal.current?.println(
              `Hashed ${minedChunksCount * MIN_CHUNK_SIZE ** 2} potential home planets...`
            );
          }
          for (const homePlanetLocation of chunk.planetLocations) {
            const planetPerlin = homePlanetLocation.perlin;
            const planetX = homePlanetLocation.coords.x;
            const planetY = homePlanetLocation.coords.y;
            const planetLevel = this.entityStore.planetLevelFromHexPerlin(
              homePlanetLocation.hash,
              homePlanetLocation.perlin
            );
            const planetType = this.entityStore.planetTypeFromHexPerlin(
              homePlanetLocation.hash,
              homePlanetLocation.perlin
            );
            const planet = this.getPlanetWithId(homePlanetLocation.hash);
            const distFromOrigin = Math.sqrt(planetX ** 2 + planetY ** 2);
            if (
              planetPerlin < initPerlinMax &&
              planetPerlin >= initPerlinMin &&
              distFromOrigin < this.worldRadius &&
              distFromOrigin > spawnInnerRadius &&
              planetLevel === MIN_PLANET_LEVEL &&
              planetType === PlanetType.PLANET &&
              (!planet || !planet.isInContract) // init will fail if planet has been initialized in contract already
            ) {
              // valid home planet
              homePlanetFinder.stopExplore();
              homePlanetFinder.destroy();

              const homePlanet =
                this.getGameObjects().getPlanetWithLocation(homePlanetLocation);

              if (!homePlanet) {
                reject(
                  new Error(
                    "Unable to create default planet for your home planet's location."
                  )
                );
              } else {
                // can cast to `LocatablePlanet` because we know its location, as we just mined it.
                resolve(homePlanet as LocatablePlanet);
              }

              break;
            }
          }
        }
      );
      homePlanetFinder.startExplore();
    });
  }

  public async prospectPlanet(
    planetId: LocationId,
    bypassChecks = false
  ): Promise<Transaction<UnconfirmedProspectPlanet>> {
    const planet = this.entityStore.getPlanetWithId(planetId);

    try {
      if (!planet || !isLocatable(planet)) {
        throw new Error("you can't prospect a planet you haven't discovered");
      }

      if (!bypassChecks) {
        if (this.checkGameHasEnded()) throw new Error("game ended");

        if (!planet) {
          throw new Error("you can't prospect a planet you haven't discovered");
        }

        if (planet.owner !== this.getAccount()) {
          throw new Error("you can't prospect a planet you don't own");
        }

        if (!isLocatable(planet)) {
          throw new Error("you don't know this planet's location");
        }

        if (planet.prospectedBlockNumber !== undefined) {
          throw new Error("someone already prospected this planet");
        }

        if (
          planet.transactions?.hasTransaction(isUnconfirmedProspectPlanetTx)
        ) {
          throw new Error("you're already looking bro...");
        }

        if (planet.planetType !== PlanetType.RUINS) {
          throw new Error("this planet doesn't have an artifact on it.");
        }
      }

      localStorage.setItem(
        `${this.getAccount()?.toLowerCase()}-prospectPlanet`,
        planetId
      );

      const txIntent: UnconfirmedProspectPlanet = {
        methodName: "prospectPlanet",
        planetId: planetId,
        args: Promise.resolve([locationIdToDecStr(planetId)]),
      };

      const tx = await this.contractsAPI.submitTransaction(txIntent);

      tx.confirmedPromise.then(() =>
        NotificationManager.getInstance().artifactProspected(
          planet as LocatablePlanet
        )
      );

      return tx;
    } catch (e) {
      this.getNotificationsManager().txInitError("prospectPlanet", e.message);
      throw e;
    }
  }

  /**
   * Calls the contract to find an artifact on the given planet.
   */
  public async findArtifact(
    planetId: LocationId,
    bypassChecks = false
  ): Promise<Transaction<UnconfirmedFindArtifact>> {
    const planet = this.entityStore.getPlanetWithId(planetId);

    try {
      if (!planet) {
        throw new Error(
          "you can't find artifacts on a planet you haven't discovered"
        );
      }

      if (!isLocatable(planet)) {
        throw new Error("you don't know the biome of this planet");
      }

      if (!bypassChecks) {
        if (this.checkGameHasEnded()) {
          throw new Error("game has ended");
        }

        if (planet.owner !== this.getAccount()) {
          throw new Error("you can't find artifacts on planets you don't own");
        }

        if (planet.hasTriedFindingArtifact) {
          throw new Error(
            "someone already tried finding an artifact on this planet"
          );
        }

        if (planet.transactions?.hasTransaction(isUnconfirmedFindArtifactTx)) {
          throw new Error("you're already looking bro...");
        }

        if (planet.planetType !== PlanetType.RUINS) {
          throw new Error("this planet doesn't have an artifact on it.");
        }
      }

      // this is shitty. used for the popup window
      localStorage.setItem(
        `${this.getAccount()?.toLowerCase()}-findArtifactOnPlanet`,
        planetId
      );

      const txIntent: UnconfirmedFindArtifact = {
        methodName: "findArtifact",
        planetId: planet.locationId,
        args: Promise.resolve([]), // TODO: implement findArtifact args
      };

      const tx =
        await this.contractsAPI.submitTransaction<UnconfirmedFindArtifact>(
          txIntent
        );

      tx.confirmedPromise
        .then(() => {
          return this.waitForPlanet<Artifact>(
            planet.locationId,
            ({ current }: Diff<Planet>) => {
              return current.heldArtifactIds
                .map(this.getArtifactWithId.bind(this))
                .find(
                  (a: Artifact | undefined) =>
                    a?.planetDiscoveredOn === planet.locationId
                ) as Artifact;
            }
          ).then((foundArtifact) => {
            if (!foundArtifact) throw new Error("Artifact not found?");
            const notifManager = NotificationManager.getInstance();

            notifManager.artifactFound(
              planet as LocatablePlanet,
              foundArtifact
            );
          });
        })
        .catch(console.log);

      return tx;
    } catch (e) {
      this.getNotificationsManager().txInitError("findArtifact", e.message);
      throw e;
    }
  }

  getContractConstants(): ContractConstants {
    return this.contractConstants;
  }

  /**
   * Submits a transaction to the blockchain to deposit an artifact on a given planet.
   * You must own the planet and you must own the artifact directly (can't be locked in contract)
   */
  public async depositArtifact(
    locationId: LocationId,
    artifactId: ArtifactId
  ): Promise<Transaction<UnconfirmedDepositArtifact>> {
    try {
      localStorage.setItem(
        `${this.getAccount()?.toLowerCase()}-depositPlanet`,
        locationId
      );
      localStorage.setItem(
        `${this.getAccount()?.toLowerCase()}-depositArtifact`,
        artifactId
      );

      if (this.checkGameHasEnded()) {
        const error = new Error("game has ended");
        this.getNotificationsManager().txInitError(
          "depositArtifact",
          error.message
        );
        throw error;
      }

      const txIntent: UnconfirmedDepositArtifact = {
        methodName: "depositArtifact",
        locationId,
        artifactId,
        args: Promise.resolve([
          locationIdToDecStr(locationId),
          artifactIdToDecStr(artifactId),
        ]),
      };

      const tx = await this.contractsAPI.submitTransaction(txIntent);

      tx.confirmedPromise.then(() =>
        this.getGameObjects().updateArtifact(
          artifactId,
          (a) => (a.onPlanetId = locationId)
        )
      );

      return tx;
    } catch (e) {
      this.getNotificationsManager().txInitError("depositArtifact", e.message);
      throw e;
    }
  }

  /**
   * Withdraws the artifact that is locked up on the given planet.
   */
  public async withdrawArtifact(
    locationId: LocationId,
    artifactId: ArtifactId,
    bypassChecks = true
  ): Promise<Transaction<UnconfirmedWithdrawArtifact>> {
    try {
      if (!bypassChecks) {
        if (this.checkGameHasEnded()) {
          throw new Error("game has ended");
        }
        const planet = this.entityStore.getPlanetWithId(locationId);
        if (!planet) {
          throw new Error("tried to withdraw from unknown planet");
        }
        if (!artifactId) {
          throw new Error("must supply an artifact id");
        }
      }

      // this is shitty. used for the popup window
      localStorage.setItem(
        `${this.getAccount()?.toLowerCase()}-withdrawPlanet`,
        locationId
      );
      localStorage.setItem(
        `${this.getAccount()?.toLowerCase()}-withdrawArtifact`,
        artifactId
      );

      const txIntent: UnconfirmedWithdrawArtifact = {
        methodName: "withdrawArtifact",
        args: Promise.resolve([
          locationIdToDecStr(locationId),
          artifactIdToDecStr(artifactId),
        ]),
        locationId,
        artifactId,
      };

      this.terminal.current?.println(
        "WITHDRAW_ARTIFACT: sending withdrawal to blockchain",
        TerminalTextStyle.Sub
      );
      this.terminal.current?.newline();

      const tx = await this.contractsAPI.submitTransaction(txIntent);

      tx.confirmedPromise.then(() =>
        this.getGameObjects().updateArtifact(
          artifactId,
          (a) => (a.onPlanetId = undefined)
        )
      );

      return tx;
    } catch (e) {
      this.getNotificationsManager().txInitError("withdrawArtifact", e.message);
      throw e;
    }
  }

  public async activateArtifact(
    locationId: LocationId,
    artifactId: ArtifactId,
    wormholeTo: LocationId | undefined,
    bypassChecks = false
  ): Promise<Transaction<UnconfirmedActivateArtifact>> {
    try {
      if (this.checkGameHasEnded()) {
        throw new Error("game has ended");
      }
      if (!bypassChecks) {
        const planet = this.entityStore.getPlanetWithId(locationId);
        if (this.checkGameHasEnded()) {
          throw new Error("game has ended");
        }

        if (!planet) {
          throw new Error("tried to activate on an unknown planet");
        }
        if (!artifactId) {
          throw new Error("must supply an artifact id");
        }
      }

      localStorage.setItem(
        `${this.getAccount()?.toLowerCase()}-activatePlanet`,
        locationId
      );
      localStorage.setItem(
        `${this.getAccount()?.toLowerCase()}-activateArtifact`,
        artifactId
      );

      const txIntent: UnconfirmedActivateArtifact = {
        methodName: "activateArtifact",
        args: Promise.resolve([
          locationIdToDecStr(locationId),
          artifactIdToDecStr(artifactId),
          wormholeTo ? locationIdToDecStr(wormholeTo) : "0",
        ]),
        locationId,
        artifactId,
        wormholeTo,
      };

      // Always await the submitTransaction so we can catch rejections
      const tx = await this.contractsAPI.submitTransaction(txIntent);

      return tx;
    } catch (e) {
      this.getNotificationsManager().txInitError("activateArtifact", e.message);
      throw e;
    }
  }

  public async deactivateArtifact(
    locationId: LocationId,
    artifactId: ArtifactId,
    bypassChecks = false
  ): Promise<Transaction<UnconfirmedDeactivateArtifact>> {
    try {
      if (!bypassChecks) {
        const planet = this.entityStore.getPlanetWithId(locationId);
        if (!planet) {
          throw new Error("tried to deactivate on an unknown planet");
        }
      }

      localStorage.setItem(
        `${this.getAccount()?.toLowerCase()}-deactivatePlanet`,
        locationId
      );
      localStorage.setItem(
        `${this.getAccount()?.toLowerCase()}-deactivateArtifact`,
        artifactId
      );

      const txIntent: UnconfirmedDeactivateArtifact = {
        methodName: "deactivateArtifact",
        args: Promise.resolve([locationIdToDecStr(locationId)]),
        locationId,
        artifactId,
      };

      // Always await the submitTransaction so we can catch rejections
      const tx = await this.contractsAPI.submitTransaction(txIntent);

      return tx;
    } catch (e) {
      this.getNotificationsManager().txInitError(
        "deactivateArtifact",
        e.message
      );
      throw e;
    }
  }

  public async withdrawSilver(
    locationId: LocationId,
    amount: number,
    bypassChecks = false
  ): Promise<Transaction<UnconfirmedWithdrawSilver>> {
    try {
      if (!bypassChecks) {
        if (!this.account) throw new Error("no account");
        if (this.checkGameHasEnded()) {
          throw new Error("game has ended");
        }
        const planet = this.entityStore.getPlanetWithId(locationId);
        if (!planet) {
          throw new Error("tried to withdraw silver from an unknown planet");
        }
        if (planet.planetType !== PlanetType.TRADING_POST) {
          throw new Error("can only withdraw silver from spacetime rips");
        }
        if (planet.owner !== this.account) {
          throw new Error("can only withdraw silver from a planet you own");
        }
        if (
          planet.transactions?.hasTransaction(isUnconfirmedWithdrawSilverTx)
        ) {
          throw new Error(
            "a withdraw silver action is already in progress for this planet"
          );
        }
        if (amount > planet.silver) {
          throw new Error("not enough silver to withdraw!");
        }
        if (amount === 0) {
          throw new Error("must withdraw more than 0 silver!");
        }
        if (planet.destroyed) {
          throw new Error("can't withdraw silver from a destroyed planet");
        }
      }

      localStorage.setItem(
        `${this.getAccount()?.toLowerCase()}-withdrawSilverPlanet`,
        locationId
      );

      const txIntent: UnconfirmedWithdrawSilver = {
        methodName: "withdrawSilver",
        args: Promise.resolve([
          locationIdToDecStr(locationId),
          amount * CONTRACT_PRECISION,
        ]),
        locationId,
        amount,
      };

      // Always await the submitTransaction so we can catch rejections
      const tx = await this.contractsAPI.submitTransaction(txIntent);

      return tx;
    } catch (e) {
      this.getNotificationsManager().txInitError("withdrawSilver", e.message);
      throw e;
    }
  }

  /**
   * We have two locations which planet state can live: on the server, and on the blockchain. We use
   * the blockchain for the 'physics' of the universe, and the webserver for optional 'add-on'
   * features, which are cryptographically secure, but live off-chain.
   *
   * This function loads the planet states which live on the server. Plays nicely with our
   * notifications system and sets the appropriate loading state values on the planet.
   */
  public async refreshServerPlanetStates(planetIds: LocationId[]) {
    const planets = this.getPlanetsWithIds(planetIds);

    planetIds.forEach((id) =>
      this.getGameObjects().updatePlanet(id, (p) => {
        p.loadingServerState = true;
      })
    );

    // const messages = await getMessagesOnPlanets({ planets: planetIds });

    planets.forEach((planet) => {
      const previousPlanetEmoji = getEmojiMessage(planet);
      // planet.messages = messages[planet.locationId];
      const nowPlanetEmoji = getEmojiMessage(planet);

      // an emoji was added
      if (previousPlanetEmoji === undefined && nowPlanetEmoji !== undefined) {
        planet.emojiZoopAnimation = easeInAnimation(2000);
        // an emoji was removed
      } else if (
        nowPlanetEmoji === undefined &&
        previousPlanetEmoji !== undefined
      ) {
        planet.emojiZoopAnimation = undefined;
        planet.emojiZoopOutAnimation = emojiEaseOutAnimation(
          3000,
          previousPlanetEmoji.body.emoji
        );
      }
    });

    planetIds.forEach((id) =>
      this.getGameObjects().updatePlanet(id, (p) => {
        p.loadingServerState = false;
        p.needsServerRefresh = false;
      })
    );
  }

  /**
   * If you are the owner of this planet, you can set an 'emoji' to hover above the planet.
   * `emojiStr` must be a string that contains a single emoji, otherwise this function will throw an
   * error.
   *
   * The emoji is stored off-chain in a postgres database. We verify planet ownership via a contract
   * call from the webserver, and by verifying that the request to add (or remove) an emoji from a
   * planet was signed by the owner.
   */
  public setPlanetEmoji(locationId: LocationId, emojiStr: string) {
    return this.submitPlanetMessage(locationId, PlanetMessageType.EmojiFlag, {
      emoji: emojiStr,
    });
  }

  /**
   * If you are the owner of this planet, you can delete the emoji that is hovering above the
   * planet.
   */
  public async clearEmoji(locationId: LocationId) {
    // todo: implement this
  }

  /**
   * The planet emoji feature is built on top of a more general 'Planet Message' system, which
   * allows players to upload pieces of data called 'Message's to planets that they own. Emojis are
   * just one type of message. Their implementation leaves the door open to more off-chain data.
   */
  private async submitPlanetMessage(
    locationId: LocationId,
    type: PlanetMessageType,
    body: unknown
  ) {
    //todo: implement this
  }

  /**
   * Checks that a message signed by {@link GameManager#signMessage} was signed by the address that
   * it claims it was signed by.
   */
  // private async verifyMessage(message: SignedMessage<unknown>): Promise<boolean> {
  //   const preSigned = JSON.stringify(message.message);

  //   return verifySignature(preSigned, message.signature as string, message.sender);
  // }

  /**
   * Submits a transaction to the blockchain to move the given amount of resources from
   * the given planet to the given planet.
   */
  public async move(
    from: LocationId,
    to: LocationId,
    forces: number,
    silver: number,
    artifactMoved?: ArtifactId,
    abandoning = false,
    bypassChecks = false,
    uiTimestamp?: number
  ): Promise<Transaction<UnconfirmedMove>> {
    localStorage.setItem(
      `${this.getAccount()?.toLowerCase()}-fromPlanet`,
      from
    );
    localStorage.setItem(`${this.getAccount()?.toLowerCase()}-toPlanet`, to);

    try {
      if (!bypassChecks && this.checkGameHasEnded()) {
        throw new Error("game has ended");
      }

      const arrivalsToOriginPlanet =
        this.entityStore.getArrivalIdsForLocation(from);
      const hasIncomingVoyage =
        arrivalsToOriginPlanet && arrivalsToOriginPlanet.length > 0;
      if (abandoning && hasIncomingVoyage) {
        throw new Error("cannot abandon a planet that has incoming voyages");
      }

      const oldLocation = this.entityStore.getLocationOfPlanet(from);
      const newLocation = this.entityStore.getLocationOfPlanet(to);
      if (!oldLocation) {
        throw new Error("tried to move from planet that does not exist");
      }
      if (!newLocation) {
        throw new Error("tried to move from planet that does not exist");
      }

      const oldX = oldLocation.coords.x;
      const oldY = oldLocation.coords.y;
      const newX = newLocation.coords.x;
      const newY = newLocation.coords.y;
      const xDiff = newX - oldX;
      const yDiff = newY - oldY;

      const distMax = Math.ceil(Math.sqrt(xDiff ** 2 + yDiff ** 2));

      // Contract will automatically send full forces/silver on abandon
      const shipsMoved = !abandoning ? forces : 0;
      const silverMoved = !abandoning ? silver : 0;

      if (newX ** 2 + newY ** 2 >= this.worldRadius ** 2) {
        throw new Error("attempted to move out of bounds");
      }

      const oldPlanet = this.entityStore.getPlanetWithLocation(oldLocation);

      if (
        ((!bypassChecks && !this.account) ||
          !oldPlanet ||
          oldPlanet.owner !== this.account) &&
        !isSpaceShip(this.getArtifactWithId(artifactMoved)?.artifactType)
      ) {
        throw new Error("attempted to move from a planet not owned by player");
      }

      const getArgs = async (): Promise<unknown[]> => {
        const sourceLoc = oldLocation.hash;
        const targetLoc = newLocation.hash;
        const targetPerlin = newLocation.perlin;
        const targetPlanet = this.entityStore.getPlanetWithId(to);
        const targetLevel = targetPlanet?.planetLevel ?? 0;
        const targetRadius =
          Math.floor(Math.sqrt(newX * newX + newY * newY)) + 1;
        const args: unknown[] = [
          sourceLoc,
          targetLoc,
          targetPerlin,
          targetLevel,
          targetRadius,
          distMax,
          oldX,
          oldY,
          newX,
          newY,
        ];
        this.terminal.current?.println(
          "MOVE: args [sourceLoc, targetLoc, targetPerlin, targetLevel, targetRadius, maxDist, x1, y1, x2, y2]:",
          TerminalTextStyle.Sub
        );
        this.terminal.current?.println(
          JSON.stringify(args),
          TerminalTextStyle.Sub
        );
        this.terminal.current?.newline();
        return args;
      };

      const txIntent: UnconfirmedMove = {
        methodName: "move",
        args: getArgs(),
        from: oldLocation.hash,
        to: newLocation.hash,
        forces: shipsMoved,
        silver: silverMoved,
        artifact: artifactMoved,
        abandoning,
        uiTimestamp,
      };

      if (artifactMoved) {
        const artifact = this.entityStore.getArtifactById(artifactMoved);

        if (!bypassChecks) {
          if (!artifact) {
            throw new Error("couldn't find this artifact");
          }
          if (isActivated(artifact)) {
            throw new Error("can't move an activated artifact");
          }
          if (!oldPlanet?.heldArtifactIds?.includes(artifactMoved)) {
            throw new Error("that artifact isn't on this planet!");
          }
        }
      }

      // Always await the submitTransaction so we can catch rejections
      const tx = await this.contractsAPI.submitTransaction(txIntent);

      return tx;
    } catch (e) {
      this.getNotificationsManager().txInitError("move", e.message);
      throw e;
    }
  }

  /**
   * Submits a transaction to the blockchain to upgrade the given planet with the given
   * upgrade branch. You must own the planet, and have enough silver on it to complete
   * the upgrade.
   */
  public async upgrade(
    planetId: LocationId,
    branch: number,
    _bypassChecks = false
  ): Promise<Transaction<UnconfirmedUpgrade>> {
    try {
      // this is shitty
      localStorage.setItem(
        `${this.getAccount()?.toLowerCase()}-upPlanet`,
        planetId
      );
      localStorage.setItem(
        `${this.getAccount()?.toLowerCase()}-branch`,
        branch.toString()
      );

      const txIntent: UnconfirmedUpgrade = {
        methodName: "upgradePlanet",
        args: Promise.resolve([
          locationIdToDecStr(planetId),
          branch.toString(),
        ]),
        locationId: planetId,
        upgradeBranch: branch,
      };

      // Always await the submitTransaction so we can catch rejections
      const tx = await this.contractsAPI.submitTransaction(txIntent);

      return tx;
    } catch (e) {
      this.getNotificationsManager().txInitError("upgradePlanet", e.message);
      throw e;
    }
  }

  /**
   * Submits a transaction to the blockchain to buy a hat for the given planet. You must own the
   * planet. Warning costs real xdai. Hats are permanently locked to a planet. They are purely
   * cosmetic and a great way to BM your opponents or just look your best. Just like in the real
   * world, more money means more hat.
   */
  public async buyHat(
    planetId: LocationId,
    _bypassChecks = false
  ): Promise<Transaction<UnconfirmedBuyHat>> {
    const planetLoc = this.entityStore.getLocationOfPlanet(planetId);
    const planet = this.entityStore.getPlanetWithLocation(planetLoc);

    try {
      if (!planetLoc) {
        console.error("planet not found");
        throw new Error("[TX ERROR] Planet not found");
      }
      if (!planet) {
        console.error("planet not found");
        throw new Error("[TX ERROR] Planet not found");
      }

      localStorage.setItem(
        `${this.getAccount()?.toLowerCase()}-hatPlanet`,
        planetId
      );
      localStorage.setItem(
        `${this.getAccount()?.toLowerCase()}-hatLevel`,
        planet.hatLevel.toString()
      );

      const txIntent: UnconfirmedBuyHat = {
        methodName: "buyHat",
        args: Promise.resolve([locationIdToDecStr(planetId)]),
        locationId: planetId,
      };

      // Always await the submitTransaction so we can catch rejections
      const tx = await this.contractsAPI.submitTransaction(txIntent);

      return tx;
    } catch (e) {
      this.getNotificationsManager().txInitError("buyHat", e.message);
      throw e;
    }
  }

  // TODO: Change this to transferPlanet in a breaking release
  public async transferOwnership(
    planetId: LocationId,
    newOwner: EthAddress,
    bypassChecks = false
  ): Promise<Transaction<UnconfirmedPlanetTransfer>> {
    try {
      if (!bypassChecks) {
        if (this.checkGameHasEnded()) {
          throw new Error("game has ended");
        }
        const planetLoc = this.entityStore.getLocationOfPlanet(planetId);
        if (!planetLoc) {
          console.error("planet not found");
          throw new Error("[TX ERROR] Planet not found");
        }
        const planet = this.entityStore.getPlanetWithLocation(planetLoc);
        if (!planet) {
          console.error("planet not found");
          throw new Error("[TX ERROR] Planet not found");
        }
      }

      localStorage.setItem(
        `${this.getAccount()?.toLowerCase()}-transferPlanet`,
        planetId
      );
      localStorage.setItem(
        `${this.getAccount()?.toLowerCase()}-transferOwner`,
        newOwner
      );

      const txIntent: UnconfirmedPlanetTransfer = {
        methodName: "transferPlanet",
        args: Promise.resolve([locationIdToDecStr(planetId), newOwner]),
        planetId,
        newOwner,
      };

      // Always await the submitTransaction so we can catch rejections
      const tx = await this.contractsAPI.submitTransaction(txIntent);

      return tx;
    } catch (e) {
      this.getNotificationsManager().txInitError("transferPlanet", e.message);
      throw e;
    }
  }

  /**
   * Admin-only: create a planet at the given coordinates with the given level and type.
   * Calls Admin.create_planet(AdminCreatePlanetArgs). require_valid_location_id is false.
   * Coords are rounded to integers (map clicks can yield floats).
   */
  public async createPlanet(
    coords: WorldCoords,
    level: number,
    planetType: number
  ): Promise<Transaction<UnconfirmedCreatePlanet>> {
    try {
      const intCoords: WorldCoords = {
        x: Math.round(Number(coords.x)),
        y: Math.round(Number(coords.y)),
      };
      const locationIdBigInt = await this.locationBigIntFromCoords(intCoords);
      const perlin = this.spaceTypePerlin(intCoords, false);
      const locationId = locationIdFromBigInt(locationIdBigInt);
      const txIntent: UnconfirmedCreatePlanet = {
        methodName: "createPlanet",
        args: Promise.resolve([
          locationIdBigInt,
          perlin & 0xff,
          Math.max(0, Math.min(9, Math.floor(level))),
          Math.max(0, Math.min(4, Math.floor(planetType))),
          false,
        ]),
        locationId,
        coords: intCoords,
        level: Math.max(0, Math.min(9, Math.floor(level))),
        planetType: Math.max(0, Math.min(4, Math.floor(planetType))),
      };
      return await this.contractsAPI.submitTransaction(txIntent);
    } catch (e) {
      this.getNotificationsManager().txInitError("createPlanet", e.message);
      throw e;
    }
  }

  public async setWorldConfig(
    worldConfig: WorldConfig
  ): Promise<Transaction<UnconfirmedSetWorldConfig>> {
    try {
      const txIntent: UnconfirmedSetWorldConfig = {
        methodName: "setWorldConfig",
        args: Promise.resolve([worldConfig]),
      };

      const tx = await this.contractsAPI.submitTransaction(txIntent);

      return tx;
    } catch (e) {
      this.getNotificationsManager().txInitError("setWorldConfig", e.message);
      throw e;
    }
  }

  public async getWorldConfig(): Promise<WorldConfig> {
    const config = await this.contractsAPI.getConfig();
    return config.worldConfig as WorldConfig;
  }

  public async pauseGame(): Promise<Transaction<UnconfirmedPauseGame>> {
    try {
      const txIntent: UnconfirmedPauseGame = {
        methodName: "pauseGame",
        args: [],
      };
      return await this.contractsAPI.submitTransaction(txIntent);
    } catch (e) {
      this.getNotificationsManager().txInitError("pauseGame", e.message);
      throw e;
    }
  }

  public async unpauseGame(): Promise<Transaction<UnconfirmedUnpauseGame>> {
    try {
      const txIntent: UnconfirmedUnpauseGame = {
        methodName: "unpauseGame",
        args: [],
      };
      return await this.contractsAPI.submitTransaction(txIntent);
    } catch (e) {
      this.getNotificationsManager().txInitError("unpauseGame", e.message);
      throw e;
    }
  }

  public async safeSetOwner(
    planetId: LocationId,
    newOwner: EthAddress
  ): Promise<Transaction<UnconfirmedSafeSetOwner>> {
    try {
      const location = this.getLocationOfPlanet(planetId);
      if (!location) {
        throw new Error(`Cannot find location for planet ${planetId}`);
      }
      const planet = this.getPlanetWithId(planetId);
      const x = location.coords.x;
      const y = location.coords.y;
      const perlin = location.perlin;
      const level = planet?.planetLevel ?? 0;

      const txIntent: UnconfirmedSafeSetOwner = {
        methodName: "safeSetOwner",
        args: Promise.resolve([x, y, planetId, perlin, level, newOwner]),
        locationId: planetId,
        location,
        newOwner,
      };
      return await this.contractsAPI.submitTransaction(txIntent);
    } catch (e) {
      this.getNotificationsManager().txInitError("safeSetOwner", e.message);
      throw e;
    }
  }

  /**
   * Makes this game manager aware of a new chunk - which includes its location, size,
   * as well as all of the planets contained in that chunk. Causes the client to load
   * all of the information about those planets from the blockchain.
   */
  addNewChunk(chunk: Chunk): GameManager {
    this.persistentChunkStore.addChunk(chunk, true);
    for (const planetLocation of chunk.planetLocations) {
      this.entityStore.addPlanetLocation(planetLocation);

      if (this.entityStore.isPlanetInContract(planetLocation.hash)) {
        this.hardRefreshPlanet(planetLocation.hash); // don't need to await, just start the process of hard refreshing
      }
    }
    return this;
  }

  // listenForNewBlock() {
  //   this.getEthConnection().blockNumber$.subscribe((blockNumber) => {
  //     if (this.captureZoneGenerator) {
  //       this.captureZoneGenerator.generate(blockNumber);
  //     }
  //   });
  // }

  /**
   * To add multiple chunks at once, use this function rather than `addNewChunk`, in order
   * to load all of the associated planet data in an efficient manner.
   */
  async bulkAddNewChunks(chunks: Chunk[]): Promise<void> {
    this.terminal.current?.println(
      "IMPORTING MAP: if you are importing a large map, this may take a while..."
    );
    const planetIdsToUpdate: LocationId[] = [];
    for (const chunk of chunks) {
      this.persistentChunkStore.addChunk(chunk, true);
      for (const planetLocation of chunk.planetLocations) {
        this.entityStore.addPlanetLocation(planetLocation);

        if (this.entityStore.isPlanetInContract(planetLocation.hash)) {
          // Await this so we don't crash the game
          planetIdsToUpdate.push(planetLocation.hash);
        }
      }
    }
    this.terminal.current?.println(
      `downloading data for ${planetIdsToUpdate.length} planets...`,
      TerminalTextStyle.Sub
    );
    this.bulkHardRefreshPlanets(planetIdsToUpdate);
  }

  // utils - scripting only

  /**
   * Gets the maximuim distance that you can send your energy from the given planet,
   * using the given percentage of that planet's current silver.
   */
  getMaxMoveDist(
    planetId: LocationId,
    sendingPercent: number,
    abandoning: boolean
  ): number {
    const planet = this.getPlanetWithId(planetId);
    if (!planet) throw new Error("origin planet unknown");
    return getRange(planet, sendingPercent, this.getRangeBuff(abandoning));
  }

  /**
   * Gets the distance between two planets. Throws an exception if you don't
   * know the location of either planet. Takes into account wormholes.
   */
  getDist(fromId: LocationId, toId: LocationId): number {
    const from = this.entityStore.getPlanetWithId(fromId);
    const to = this.entityStore.getPlanetWithId(toId);

    if (!from) throw new Error("origin planet unknown");
    if (!to) throw new Error("destination planet unknown");
    if (!isLocatable(from)) throw new Error("origin location unknown");
    if (!isLocatable(to)) throw new Error("destination location unknown");

    const wormholeFactors = this.getWormholeFactors(from, to);

    let distance = this.getDistCoords(from.location.coords, to.location.coords);

    if (wormholeFactors) {
      distance /= wormholeFactors.distanceFactor;
    }

    return distance;
  }

  /**
   * Gets the distance between two coordinates in space.
   */
  getDistCoords(fromCoords: WorldCoords, toCoords: WorldCoords) {
    return Math.sqrt(
      (fromCoords.x - toCoords.x) ** 2 + (fromCoords.y - toCoords.y) ** 2
    );
  }

  /**
   * Gets all the planets that you can reach with at least 1 energy from
   * the given planet. Does not take into account wormholes.
   */
  getPlanetsInRange(
    planetId: LocationId,
    sendingPercent: number,
    abandoning: boolean
  ): Planet[] {
    const planet = this.entityStore.getPlanetWithId(planetId);
    if (!planet) throw new Error("planet unknown");
    if (!isLocatable(planet)) throw new Error("planet location unknown");

    // Performance improvements originally suggested by [@modokon](https://github.com/modukon)
    // at https://github.com/darkforest-eth/client/issues/15
    // Improved by using `planetMap` by [@phated](https://github.com/phated)
    const result = [];
    const range = getRange(
      planet,
      sendingPercent,
      this.getRangeBuff(abandoning)
    );
    for (const p of this.getPlanetMap().values()) {
      if (isLocatable(p)) {
        if (
          this.getDistCoords(planet.location.coords, p.location.coords) < range
        ) {
          result.push(p);
        }
      }
    }

    return result;
  }

  /**
   * Gets the amount of energy needed in order for a voyage from the given to the given
   * planet to arrive with your desired amount of energy.
   */
  getEnergyNeededForMove(
    fromId: LocationId,
    toId: LocationId,
    arrivingEnergy: number,
    abandoning = false
  ): number {
    const from = this.getPlanetWithId(fromId);
    if (!from) throw new Error("origin planet unknown");
    const dist = this.getDist(fromId, toId);
    const rangeBuff = this.getRangeBuff(abandoning);
    const L = from.range * rangeBuff * L_OVER_RANGE;

    // Piecewise linear decay: popArriving = sentEnergy * (dMax - dist) / dMax
    // where dMax = L * getDMaxFraction(sentEnergy / energyCap * 100).
    // Binary search for the sentEnergy that yields arrivingEnergy.
    let lo = arrivingEnergy;
    let hi = from.energyCap * 2;
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      const p = (mid / from.energyCap) * 100;
      const dMax = L * getDMaxFraction(p);
      const arriving =
        dMax > 0 && dist < dMax ? (mid * (dMax - dist)) / dMax : 0;
      if (arriving < arrivingEnergy) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    const result = hi;
    // Verify the result actually arrives with positive energy
    const pCheck = (result / from.energyCap) * 100;
    const dMaxCheck = L * getDMaxFraction(pCheck);
    if (dMaxCheck <= 0 || dist >= dMaxCheck) return Infinity;
    return result;
  }

  /**
   * Gets the amount of energy that would arrive if a voyage with the given parameters
   * was to occur. The toPlanet is optional, in case you want an estimate that doesn't include
   * wormhole speedups.
   */
  getEnergyArrivingForMove(
    fromId: LocationId,
    toId: LocationId | undefined,
    distance: number | undefined,
    sentEnergy: number,
    abandoning: boolean
  ) {
    const from = this.getPlanetWithId(fromId);
    const to = this.getPlanetWithId(toId);

    if (!from) throw new Error(`unknown planet`);
    if (distance === undefined && toId === undefined)
      throw new Error(`you must provide either a target planet or a distance`);

    const dist = (toId && this.getDist(fromId, toId)) || (distance as number);

    if (to && toId) {
      const wormholeFactors = this.getWormholeFactors(from, to);
      if (wormholeFactors !== undefined) {
        if (to.owner !== from.owner) {
          return 0;
        }
      }
    }

    // Piecewise linear decay matching contract (move/src/main.nr)
    const percent = (sentEnergy / from.energyCap) * 100;
    const rangeBuff = this.getRangeBuff(abandoning);
    const dMax =
      from.range * rangeBuff * L_OVER_RANGE * getDMaxFraction(percent);

    if (dist >= dMax || dMax <= 0) return 0;
    return (sentEnergy * (dMax - dist)) / dMax;
  }

  /**
   * Gets the active artifact on this planet, if one exists.
   */
  getActiveArtifact(planet: Planet): Artifact | undefined {
    const artifacts = this.getArtifactsWithIds(planet.heldArtifactIds);
    const active = artifacts.find((a) => a && isActivated(a));

    return active;
  }

  /**
   * If there's an active artifact on either of these planets which happens to be a wormhole which
   * is active and targetting the other planet, return the wormhole boost which is greater. Values
   * represent a multiplier.
   */
  getWormholeFactors(
    fromPlanet: Planet,
    toPlanet: Planet
  ): { distanceFactor: number; speedFactor: number } | undefined {
    const fromActiveArtifact = this.getActiveArtifact(fromPlanet);
    const toActiveArtifact = this.getActiveArtifact(toPlanet);

    let greaterRarity: ArtifactRarity | undefined;

    if (
      fromActiveArtifact?.artifactType === ArtifactType.Wormhole &&
      fromActiveArtifact.wormholeTo === toPlanet.locationId
    ) {
      greaterRarity = fromActiveArtifact.rarity;
    }

    if (
      toActiveArtifact?.artifactType === ArtifactType.Wormhole &&
      toActiveArtifact.wormholeTo === fromPlanet.locationId
    ) {
      if (greaterRarity === undefined) {
        greaterRarity = toActiveArtifact.rarity;
      } else {
        greaterRarity = Math.max(
          greaterRarity,
          toActiveArtifact.rarity
        ) as ArtifactRarity;
      }
    }

    const rangeUpgradesPerRarity = [0, 2, 4, 6, 8, 10];
    const speedUpgradesPerRarity = [0, 10, 20, 30, 40, 50];

    if (!greaterRarity || greaterRarity <= ArtifactRarity.Unknown) {
      return undefined;
    }

    return {
      distanceFactor: rangeUpgradesPerRarity[greaterRarity],
      speedFactor: speedUpgradesPerRarity[greaterRarity],
    };
  }

  /**
   * Gets the amount of time, in seconds that a voyage between from the first to the
   * second planet would take.
   */
  getTimeForMove(
    fromId: LocationId,
    toId: LocationId,
    abandoning = false
  ): number {
    const from = this.getPlanetWithId(fromId);
    if (!from) throw new Error("origin planet unknown");
    const dist = this.getDist(fromId, toId);

    const speed = from.speed * this.getSpeedBuff(abandoning);
    return dist / (speed / 100);
  }

  /**
   * Gets the temperature of a given location.
   */
  getTemperature(coords: WorldCoords): number {
    const p = this.spaceTypePerlin(coords, false);
    return (16 - p) * 16;
  }

  /**
   * Load the serialized versions of all the plugins that this player has.
   */
  public async loadPlugins(): Promise<SerializedPlugin[]> {
    return this.persistentChunkStore.loadPlugins();
  }

  /**
   * Overwrites all the saved plugins to equal the given array of plugins.
   */
  public async savePlugins(savedPlugins: SerializedPlugin[]): Promise<void> {
    await this.persistentChunkStore.savePlugins(savedPlugins);
  }

  /**
   * Whether or not the given planet is capable of minting an artifact.
   */
  public isPlanetMineable(p: Planet): boolean {
    return p.planetType === PlanetType.RUINS;
  }

  /**
   * Returns constructors of classes that may be useful for developing plugins.
   */

  public getConstructors() {
    return {
      MinerManager,
      SpiralPattern,
      SwissCheesePattern,
      TowardsCenterPattern,
      TowardsCenterPatternV2,
    };
  }

  /**
   * Gets the perlin value at the given location in the world. SpaceType is based
   * on this value.
   */
  public spaceTypePerlin(coords: WorldCoords, floor: boolean): number {
    return perlin(coords, {
      key: this.hashConfig.spaceTypeKey,
      scale: this.hashConfig.perlinLengthScale,
      mirrorX: this.hashConfig.perlinMirrorX,
      mirrorY: this.hashConfig.perlinMirrorY,
      floor,
    });
  }

  /**
   * Gets the biome perlin valie at the given location in the world.
   */
  public biomebasePerlin(coords: WorldCoords, floor: boolean): number {
    return perlin(coords, {
      key: this.hashConfig.biomebaseKey,
      scale: this.hashConfig.perlinLengthScale,
      mirrorX: this.hashConfig.perlinMirrorX,
      mirrorY: this.hashConfig.perlinMirrorY,
      floor,
    });
  }

  public async locationBigIntFromCoords(coords: WorldCoords): Promise<bigint> {
    return this.planetHashAt(coords.x, coords.y);
  }

  /**
   * Helpful for listening to user input events.
   */
  public getUIEventEmitter() {
    return UIEmitter.getInstance();
  }

  // public getCaptureZoneGenerator() {
  //   return this.captureZoneGenerator;
  // }

  /**
   * Emits when new capture zones are generated.
   */
  // public get captureZoneGeneratedEmitter(): Monomitter<CaptureZonesGeneratedEvent> | undefined {
  //   return this.captureZoneGenerator?.generated$;
  // }

  public getNotificationsManager() {
    return NotificationManager.getInstance();
  }

  getWormholes(): Iterable<Wormhole> {
    return this.entityStore.getWormholes();
  }

  /** Return a reference to the planet map */
  public getPlanetMap(): Map<LocationId, Planet> {
    return this.entityStore.getPlanetMap();
  }

  /** Return a reference to the artifact map */
  public getArtifactMap(): Map<ArtifactId, Artifact> {
    return this.entityStore.getArtifactMap();
  }

  /** Return a reference to the map of my planets */
  public getMyPlanetMap(): Map<LocationId, Planet> {
    return this.entityStore.getMyPlanetMap();
  }

  /** Return a reference to the map of my artifacts */
  public getMyArtifactMap(): Map<ArtifactId, Artifact> {
    return this.entityStore.getMyArtifactMap();
  }

  public getPlanetUpdated$(): Monomitter<LocationId> {
    return this.entityStore.planetUpdated$;
  }

  public getArtifactUpdated$(): Monomitter<ArtifactId> {
    return this.entityStore.artifactUpdated$;
  }

  public getMyPlanetsUpdated$(): Monomitter<Map<LocationId, Planet>> {
    return this.entityStore.myPlanetsUpdated$;
  }

  public getMyArtifactsUpdated$(): Monomitter<Map<ArtifactId, Artifact>> {
    return this.entityStore.myArtifactsUpdated$;
  }

  /**
   * Returns an instance of a `Contract` from the ethersjs library. This is the library we use to
   * connect to the blockchain. For documentation about how `Contract` works, see:
   * https://docs.ethers.io/v5/api/contract/contract/
   *
   * Also, registers your contract in the system to make calls against it and to reload it when
   * necessary (such as the RPC endpoint changing).
   */
  // public loadContract<T extends Contract>(
  //   contractAddress: string,
  //   contractABI: ContractInterface
  // ): Promise<T> {
  //   return this.ethConnection.loadContract(contractAddress, async (address, provider, signer) =>
  //     createContract<T>(address, contractABI, provider, signer)
  //   );
  // }

  public testNotification() {
    NotificationManager.getInstance().reallyLongNotification();
  }

  /**
   * Gets a reference to the game's internal representation of the world state. This includes
   * voyages, planets, artifacts, and active wormholes,
   */
  public getGameObjects(): GameObjects {
    return this.entityStore;
  }

  public forceTick(locationId: LocationId) {
    this.getGameObjects().forceTick(locationId);
  }

  /**
   * Gets some diagnostic information about the game. Returns a copy, you can't modify it.
   */
  public getDiagnostics(): Diagnostics {
    return { ...this.diagnostics };
  }

  /**
   * Updates the diagnostic info of the game using the supplied function. Ideally, each spot in the
   * codebase that would like to record a metric is able to update its specific metric in a
   * convenient manner.
   */
  public updateDiagnostics(updateFn: (d: Diagnostics) => void): void {
    updateFn(this.diagnostics);
  }

  /**
   * Listen for changes to a planet take action,
   * eg.
   * waitForPlanet("yourAsteroidId", ({current}) => current.silverCap / current.silver > 90)
   * .then(() => {
   *  // Send Silver to nearby planet
   * })
   *
   * @param locationId A locationId to watch for updates
   * @param predicate a function that accepts a Diff and should return a truth-y value, value will be passed to promise.resolve()
   * @returns a promise that will resolve with results returned from the predicate function
   */
  public waitForPlanet<T>(
    locationId: LocationId,
    predicate: ({ current, previous }: Diff<Planet>) => T | undefined
  ): Promise<T> {
    const disposableEmitter = getDisposableEmitter<Planet, LocationId>(
      this.getPlanetMap(),
      locationId,
      this.getPlanetUpdated$()
    );
    const diffEmitter = generateDiffEmitter(disposableEmitter);
    return new Promise((resolve, reject) => {
      diffEmitter.subscribe((diff) => {
        if (!diff) return;
        const { current, previous } = diff;
        try {
          const predicateResults = predicate({ current, previous });
          if (predicateResults) {
            disposableEmitter.clear();
            diffEmitter.clear();
            resolve(predicateResults);
          }
        } catch (err) {
          disposableEmitter.clear();
          diffEmitter.clear();
          reject(err);
        }
      });
    });
  }

  public getSafeMode() {
    return this.safeMode;
  }

  public setSafeMode(safeMode: boolean) {
    this.safeMode = safeMode;
  }

  public getAddress(): EthAddress | undefined {
    return this.contractsAPI.getAddress();
  }

  public isAdmin(): boolean {
    return this.getAddress() === this.contractConstants.adminAddress;
  }

  /**
   * Right now the only buffs supported in this way are
   * speed/range buffs from Abandoning a planet.
   *
   * The abandoning argument is used when interacting with
   * this function programmatically.
   */
  public getSpeedBuff(abandoning: boolean): number {
    const { SPACE_JUNK_ENABLED, ABANDON_SPEED_CHANGE_PERCENT } =
      this.contractConstants;
    if (SPACE_JUNK_ENABLED && abandoning) {
      return ABANDON_SPEED_CHANGE_PERCENT / 100;
    }

    return 1;
  }

  public getRangeBuff(abandoning: boolean): number {
    const { SPACE_JUNK_ENABLED, ABANDON_RANGE_CHANGE_PERCENT } =
      this.contractConstants;
    if (SPACE_JUNK_ENABLED && abandoning) {
      return ABANDON_RANGE_CHANGE_PERCENT / 100;
    }

    return 1;
  }

  public async submitTransaction<T extends TxIntent>(
    txIntent: T
  ): Promise<Transaction<T>> {
    return this.contractsAPI.submitTransaction(txIntent);
  }

  public getPaused(): boolean {
    return this.paused;
  }

  public getPaused$(): Monomitter<boolean> {
    return this.paused$;
  }
}

export default GameManager;
