import { EMPTY_ADDRESS, EMPTY_ARTIFACT_ID } from "@dfpunk/constants";
import { formatNumber, hasOwner } from "@dfpunk/gamelogic";
import { getOwnerColorVec } from "@dfpunk/procedural";
import {
  ArtifactId,
  LocationId,
  Planet,
  Player,
  QueuedArrival,
  RendererType,
  RenderZIndex,
  TextAlign,
  TextAnchor,
  Transaction,
  UnconfirmedMove,
  VoyageId,
  VoyageRendererType,
} from "@dfpunk/types";
import { engineConsts } from "../EngineConsts";
import { Renderer } from "../Renderer";
import { GameGLManager } from "../WebGL/GameGLManager";

const { white, gold } = engineConsts.colors;
const { enemyA, mineA, shipA } = engineConsts.colors.voyage;

function getVoyageColor(
  fromPlanet: Planet,
  toPlanet: Planet,
  isMine: boolean,
  isShip: boolean,
) {
  if (isMine) {
    return mineA;
  }

  const isAttack = hasOwner(toPlanet) && fromPlanet.owner !== toPlanet.owner;
  if (isAttack) {
    if (isShip) {
      return shipA;
    } else {
      return enemyA;
    }
  }

  return getOwnerColorVec(fromPlanet);
}

/** Canvas-pixel radius around the fleet dot within which hover reveals text. */
const HOVER_REVEAL_PX = 28;

/** How long an optimistic dot may await its confirmed arrival after the tx
 * leaves the unconfirmed list, before being dropped (ms, wall clock).
 * Must exceed worst-case event-delivery lag (~2 blocks on mainnet). */
const OPTIMISTIC_MATCH_GRACE_MS = 150_000;

/** Tightened grace once the tx is CONFIRMED and removed from the queue —
 * removal happens only after indexer sync + hard refresh, so an arrival
 * event still missing means it was applied at ingestion (a short hop
 * whose arrival time predates the inclusion block's timestamp). Kept
 * just long enough to absorb store-propagation frames: a parked dot
 * shows a stale "confirming" the whole time. */
const CONFIRMED_MATCH_GRACE_MS = 3_000;

/** Max catch-up speed factor a linear confirmed schedule may require. */
const MAX_SCHEDULE_RATE = 2;

/** Minimum runway (ms) for a linear confirmed schedule. */
const MIN_SCHEDULE_RUNWAY_MS = 5_000;

/** Duration of the wall-time terminal/reconciliation glide (ms). */
const GLIDE_MS = 4_000;

/**
 * A not-yet-confirmed outgoing move rendered as a fleet dot leaving the
 * source planet, so departure is visible during proving/confirmation
 * instead of the voyage popping up mid-flight when the event lands.
 * Progress runs on DISPLAY time from a display-anchored submit point, so
 * the dot and every ETA share one time base.
 */
interface OptimisticVoyage {
  txId: number;
  /** The transaction itself — failure outcomes are keyed by object. */
  tx: Transaction<UnconfirmedMove>;
  from: LocationId;
  to: LocationId;
  artifactId: ArtifactId | undefined;
  /** Display-time ms at submission (derived once via the wall clock). */
  submitDisplayMs: number;
  /**
   * Expected CHAIN arrival: raw block time at submit + estimated travel.
   * The contract stamps departure at the LAST BLOCK's timestamp, so the
   * real trip completes early by that block's staleness — targeting the
   * expected arrival keeps the dot's speed constant from launch and the
   * ETA honest from the first frame (no compression at confirmation).
   */
  targetArrivalMs: number;
  /** Visual flight span in ms (target − submit, floored for near-instant trips). */
  spanMs: number;
  /** Latest rendered proportion; p0 of the confirmed schedule. */
  lastProportion: number;
  /** Wall deadline for finding the confirmed arrival once the tx is gone. */
  unmatchedDeadlineMs: number | undefined;
  /** Arrivals that already existed at creation — never match those. */
  preexistingArrivals: Set<VoyageId>;
}

/**
 * How a voyage with visual history is rendered:
 * - linear: continue from (d0, p0) to reach the destination exactly at
 *   the CHAIN ARRIVAL — ETA is honest, and the "arriving" hold begins
 *   only when maturation genuinely can (rates below 1x are fine: the
 *   dot just cruises slower). The schedule never outlives maturation.
 * - trace: a fast sweep from `fromP` to the TRUE real-schedule
 *   position, after which the schedule deletes itself and honest
 *   rendering takes over. Used for foreign voyages inbound to the
 *   viewer's planet (fromP = source) and for own handovers too steep
 *   for a bounded-rate linear schedule (fromP = the optimistic dot).
 */
type VoyageSchedule =
  | { mode: "linear"; d0Ms: number; p0: number; deadlineMs: number }
  | { mode: "trace"; glideStartWallMs: number; fromP: number };

/** Duration of the inbound trace-in sweep (ms, wall clock). */
const TRACE_MS = 800;

/** Duration of one arrival-flash beacon cycle (ms, wall clock). */
const FLASH_MS = 1_200;

/** A one-shot landing-beacon cycle at a planet that just received an arrival. */
interface ArrivalFlash {
  center: { x: number; y: number };
  planetLevel: Planet["planetLevel"];
  startWallMs: number;
  color: [number, number, number, number];
}

/**
 * Renderer-only remnant of a voyage whose canonical state matured while
 * its dot was still mid-flight: finishes the trip with a short ease-out
 * instead of vanishing. Never delays canonical planet updates.
 */
interface TerminalGhost {
  fromCoords: { x: number; y: number };
  toCoords: { x: number; y: number };
  p0: number;
  glideStartWallMs: number;
  color: [number, number, number, number];
  /** Fired at the destination when the ghost finishes its glide. */
  flashOnComplete: ArrivalFlash | undefined;
}

/** Normalize "no artifact": undefined and the EMPTY id are equivalent. */
function normalizeArtifactId(
  id: ArtifactId | undefined,
): ArtifactId | undefined {
  return id && id !== EMPTY_ARTIFACT_ID ? id : undefined;
}

/**
 * Transaction outcomes, tracked renderer-independently: attaching
 * per-renderer closures to long-lived transaction promises would retain
 * old renderer graphs across HMR / account switches. The single watcher
 * closure captures only module-level state; renderer instances consume
 * outcomes from `failedTxs` / `confirmedTxs`.
 */
const watchedTxOutcomes = new WeakSet<Transaction<UnconfirmedMove>>();
const failedTxs = new WeakSet<Transaction<UnconfirmedMove>>();
const confirmedTxs = new WeakSet<Transaction<UnconfirmedMove>>();
function watchTxOutcome(tx: Transaction<UnconfirmedMove>): void {
  if (watchedTxOutcomes.has(tx)) return;
  watchedTxOutcomes.add(tx);
  // Keyed by the transaction OBJECT: numeric ids restart per session
  // and could delete an unrelated later voyage with the same id.
  void tx.confirmedPromise.then(
    () => {
      confirmedTxs.add(tx);
    },
    () => {
      failedTxs.add(tx);
    },
  );
}

/* responsible for calling renderers in order to draw voyages */
export class VoyageRenderer implements VoyageRendererType {
  renderer: Renderer;

  rendererType = RendererType.Voyager;

  /** Voyages currently holding at their destination ("arriving"), by eventId. */
  private heldVoyages = new Set<VoyageId>();

  /** Optimistic (unconfirmed) outgoing moves being animated, by tx id. */
  private optimisticByTxId = new Map<number, OptimisticVoyage>();

  /** Visual schedules for confirmed voyages that had an optimistic dot. */
  private scheduleByArrivalId = new Map<VoyageId, VoyageSchedule>();

  /** Last-frame render facts per voyage, for ghost/flash spawning. */
  private lastVoyageFrame = new Map<
    VoyageId,
    {
      fromCoords: { x: number; y: number };
      toCoords: { x: number; y: number };
      proportion: number;
      color: [number, number, number, number];
      planetLevel: Planet["planetLevel"];
      isForeign: boolean;
    }
  >();

  /** Active terminal ghosts (early-matured voyages easing in). */
  private ghosts: TerminalGhost[] = [];

  /** Voyage ids already given (or exempted from) an entry animation. */
  private seenVoyageIds = new Set<VoyageId>();

  /** True once the initial store snapshot has been exempted from entry FX. */
  private bootstrapped = false;

  /** Active one-shot arrival flashes. */
  private flashes: ArrivalFlash[] = [];

  /** Per-frame beacon dedupe: one beacon (and label) per destination. */
  private beaconsThisFrame = new Map<
    LocationId,
    {
      center: { x: number; y: number };
      toPlanet: Planet;
      alpha: number;
      count: number;
      hovered: boolean;
    }
  >();

  constructor(gl: GameGLManager) {
    this.renderer = gl.renderer;
  }

  /** True when the cursor is within HOVER_REVEAL_PX of the given world point. */
  private isHoveredAt(worldCoords: { x: number; y: number }): boolean {
    const hover = this.renderer.context.getHoveringOverCoords();
    if (!hover) return false;
    const viewport = this.renderer.getViewport();
    const hoverCanvas = viewport.worldToCanvasCoords(hover);
    const pointCanvas = viewport.worldToCanvasCoords(worldCoords);
    return (
      Math.hypot(hoverCanvas.x - pointCanvas.x, hoverCanvas.y - pointCanvas.y) <
      HOVER_REVEAL_PX
    );
  }

  /**
   * Track unconfirmed moves as optimistic voyages; when the tx confirms,
   * the matched arrival inherits the optimistic wall-time schedule (or
   * falls back to real-schedule rendering on material divergence).
   */
  private reconcileOptimistic(
    displayNowMs: number,
    naturalNowMs: number,
    voyages: QueuedArrival[],
    unconfirmed: Transaction<UnconfirmedMove>[],
  ): void {
    const ctx = this.renderer.context;
    const liveTxIds = new Set<number>();

    for (const tx of unconfirmed) {
      if (tx.state === "Fail" || tx.state === "Cancel") {
        this.optimisticByTxId.delete(tx.id);
        continue;
      }
      // Any present, non-dead tx keeps its entry live: a CONFIRMED tx
      // stays in the unconfirmed list through indexer sync + hard
      // refresh (queue removal happens only after both), and the match
      // grace must not start until the store holds post-inclusion state.
      liveTxIds.add(tx.id);
      // Only animate once the tx is actually broadcast: pre-Submit states
      // (local proving) can still fail without ever reaching the chain.
      if (tx.state !== "Submit") continue;
      if (this.optimisticByTxId.has(tx.id)) continue;

      const fromLoc = ctx.getLocationOfPlanet(tx.intent.from);
      const toLoc = ctx.getLocationOfPlanet(tx.intent.to);
      if (!fromLoc || !toLoc) continue;
      let durationSec: number;
      try {
        durationSec = ctx.getTimeForMove(
          tx.intent.from,
          tx.intent.to,
          tx.intent.abandoning,
        );
      } catch {
        continue;
      }
      if (!Number.isFinite(durationSec) || durationSec <= 0) continue;
      if (displayNowMs <= 0) continue; // clock not live yet
      // Txs leave the unconfirmed queue before the state-based branch
      // above can observe their outcome — watch the confirmation promise
      // (renderer-independently) so dead dots don't fly out the match
      // grace and instantly-applied arrivals finish promptly.
      watchTxOutcome(tx);
      // Display-time submit anchor, derived from the wall-clock age of
      // the Submit transition so backgrounded submits anchor correctly.
      const submitDisplayMs =
        displayNowMs - Math.max(naturalNowMs - tx.lastUpdatedAt, 0);
      // Anchor on the intent's uiTimestamp: it is the exact value the
      // contract will stamp as departure_time. Raw time at Submit
      // observation can be a block fresher (proving takes ~10-30s),
      // which would make the target systematically late and recreate
      // the confirmation compression.
      const departureMs =
        tx.intent.uiTimestamp !== undefined
          ? Math.floor(tx.intent.uiTimestamp) * 1000
          : ctx.getChainTimeMs();
      const targetArrivalMs = departureMs + durationSec * 1000;
      const spanMs = Math.max(targetArrivalMs - submitDisplayMs, 3_000);
      this.optimisticByTxId.set(tx.id, {
        txId: tx.id,
        tx,
        from: tx.intent.from,
        to: tx.intent.to,
        artifactId: normalizeArtifactId(tx.intent.artifact),
        submitDisplayMs,
        targetArrivalMs,
        spanMs,
        lastProportion: 0.01,
        unmatchedDeadlineMs: undefined,
        preexistingArrivals: new Set(voyages.map((v) => v.eventId)),
      });
    }

    // Match entries to their confirmed arrival the frame it appears, and
    // expire the unmatched only after the tx leaves the queue.
    for (const entry of [...this.optimisticByTxId.values()]) {
      // Consume terminal outcomes first — the promise rejection AND the
      // tx object's own state: a reverted tx flips to "Fail" before its
      // retry loop or removal settles the promise, and a cancelled tx's
      // promise may never settle at all.
      if (
        failedTxs.has(entry.tx) ||
        entry.tx.state === "Fail" ||
        entry.tx.state === "Cancel"
      ) {
        this.optimisticByTxId.delete(entry.txId);
        continue;
      }
      const isLive = liveTxIds.has(entry.txId);
      // Match as soon as the tx has CONFIRMED, even while still queued:
      // the hard refresh ingests the canonical voyage BEFORE queue
      // removal, and deferring the handover would draw both dots. A
      // Submit-state entry must NOT match — its arrival cannot exist
      // yet, and it could steal an earlier same-route arrival.
      const canMatch = !isLive || entry.tx.state === "Confirm";
      if (!canMatch) continue;
      if (!isLive && entry.unmatchedDeadlineMs === undefined) {
        entry.unmatchedDeadlineMs = naturalNowMs + OPTIMISTIC_MATCH_GRACE_MS;
      }
      const match = this.findMatchingArrival(entry, voyages);
      if (match) {
        // Target the chain arrival TRANSLATED into the display base
        // (displayArrivalMs): the dot touches down when maturation can
        // actually land instead of parking in "arriving" for the whole
        // display lead. Estimated-duration error becomes a bounded speed
        // change (incl. slower than 1x), never an early park.
        // Behind-truth and too steep → sweep FORWARD to the true
        // position; ahead-of-truth always drifts linearly (a trace
        // would visibly reverse the dot).
        const targetMs = this.displayArrivalMs(match.arrivalTime * 1000);
        const p0 = entry.lastProportion;
        const runwayMs = targetMs - displayNowMs;
        const totalSec = match.arrivalTime - match.departureTime;
        // Truth measured on the RAW clock — the same base the target
        // translation subtracts, so "ahead of truth" and the deadline
        // agree on what truth is.
        const chainNowSec = ctx.getChainTimeMs() / 1000;
        const trueP =
          totalSec > 0
            ? Math.min(
                Math.max((chainNowSec - match.departureTime) / totalSec, 0),
                0.99,
              )
            : 0.99;
        const requiredRate =
          runwayMs > 0 ? ((0.99 - p0) * entry.spanMs) / runwayMs : Infinity;

        let schedule: VoyageSchedule;
        if (
          p0 >= trueP ||
          (runwayMs >= MIN_SCHEDULE_RUNWAY_MS &&
            requiredRate <= MAX_SCHEDULE_RATE)
        ) {
          schedule = {
            mode: "linear",
            d0Ms: displayNowMs,
            p0,
            deadlineMs: Math.max(targetMs, displayNowMs),
          };
        } else {
          schedule = {
            mode: "trace",
            glideStartWallMs: naturalNowMs,
            fromP: p0,
          };
        }
        this.scheduleByArrivalId.set(match.eventId, schedule);
        this.optimisticByTxId.delete(entry.txId);
      } else if (!isLive && entry.unmatchedDeadlineMs !== undefined) {
        // Instant arrival: an arrival whose arrival time ≤ its inclusion
        // block's timestamp is applied at ingestion and never surfaces a
        // QueuedArrival. Queue removal happens only after indexer sync +
        // hard refresh (GameManager's TxConfirmed handler), so once a
        // confirmed tx is gone from the queue, a missing arrival is not
        // coming. Detect eagerly via the moved artifact already orbiting
        // the destination (ends the double-sprite overlap immediately),
        // else via a tightened post-removal grace.
        const artifactLanded =
          entry.artifactId !== undefined &&
          ctx.getArtifactWithId(entry.artifactId)?.onPlanetId === entry.to;
        if (confirmedTxs.has(entry.tx)) {
          entry.unmatchedDeadlineMs = Math.min(
            entry.unmatchedDeadlineMs,
            naturalNowMs + CONFIRMED_MATCH_GRACE_MS,
          );
        }
        if (artifactLanded || naturalNowMs > entry.unmatchedDeadlineMs) {
          this.optimisticByTxId.delete(entry.txId);
          if (artifactLanded || confirmedTxs.has(entry.tx)) {
            const fromLoc = ctx.getLocationOfPlanet(entry.from);
            const toLoc = ctx.getLocationOfPlanet(entry.to);
            if (fromLoc && toLoc) {
              this.ghosts.push({
                fromCoords: fromLoc.coords,
                toCoords: toLoc.coords,
                p0: entry.lastProportion,
                glideStartWallMs: naturalNowMs,
                color: [...mineA] as [number, number, number, number],
                flashOnComplete: undefined,
              });
            }
          }
        }
      }
    }
  }

  /**
   * A chain arrival translated into the DISPLAY time base. Display time
   * runs ahead of raw block time (envelope lead + not-yet-delivered
   * blocks), so a dot scheduled against the raw arrival second touches
   * down early and then sits in "arriving" for the whole lead — up to
   * minutes when the arrival lands just after a timestamp step. Adding
   * the current lead makes the dot land roughly when maturation can
   * actually apply, and the countdown measures wall-time-to-visible-
   * landing — the number a player actually experiences. The lead is
   * sampled at schedule creation (typically right after a sync, the
   * sawtooth's minimum); if delivery beats the dot anyway, the
   * matured-early ghost absorbs the difference.
   */
  private displayArrivalMs(arrivalMs: number): number {
    const leadMs = this.renderer.now - this.renderer.context.getChainTimeMs();
    return arrivalMs + Math.max(leadMs, 0);
  }

  private findMatchingArrival(
    entry: OptimisticVoyage,
    voyages: QueuedArrival[],
  ): QueuedArrival | undefined {
    const account = this.renderer.context.getAccount();
    const candidates = voyages
      .filter(
        (v) =>
          v.fromPlanet === entry.from &&
          v.toPlanet === entry.to &&
          // Only arrivals that appeared AFTER this move was submitted.
          !entry.preexistingArrivals.has(v.eventId) &&
          !this.scheduleByArrivalId.has(v.eventId) &&
          // Exact artifact identity both ways: an artifact-less move must
          // not steal an artifact/spaceship arrival, nor vice versa.
          normalizeArtifactId(v.artifactId) === entry.artifactId &&
          (account === undefined ||
            v.player === account ||
            v.player === EMPTY_ADDRESS),
      )
      .sort((a, b) => a.departureTime - b.departureTime);
    return candidates[0];
  }

  /** Draw an optimistic (unconfirmed) departure as a mine-colored fleet. */
  private drawOptimisticFleet(entry: OptimisticVoyage): void {
    const {
      now: displayNowMs,
      context: gameUIManager,
      circleRenderer: cR,
      textRenderer: tR,
      spriteRenderer: sR,
    } = this.renderer;
    const fromLoc = gameUIManager.getLocationOfPlanet(entry.from);
    const toLoc = gameUIManager.getLocationOfPlanet(entry.to);
    if (!fromLoc || !toLoc) return;

    // Display-time progression from the submit point toward the EXPECTED
    // CHAIN ARRIVAL: constant speed from launch, ETA honest from the
    // first frame, near-zero-rate handover at confirmation.
    let proportion = (displayNowMs - entry.submitDisplayMs) / entry.spanMs;
    if (!Number.isFinite(proportion)) proportion = 0.01;
    proportion = Math.min(Math.max(proportion, 0.01), 0.99);
    entry.lastProportion = proportion;

    const shipsLocation = {
      x: (1 - proportion) * fromLoc.coords.x + proportion * toLoc.coords.x,
      y: (1 - proportion) * fromLoc.coords.y + proportion * toLoc.coords.y,
    };

    const color: [number, number, number, number] = [...mineA] as [
      number,
      number,
      number,
      number,
    ];
    cR.queueCircleWorldCenterOnly(shipsLocation, 4, color);

    // Ship/artifact sprite travels with the dot from the very first frame
    // (previously it only appeared once the voyage confirmed).
    if (entry.artifactId) {
      const artifact = gameUIManager.getArtifactWithId(entry.artifactId);
      if (artifact) {
        const viewport = this.renderer.getViewport();
        const screenCoords = viewport.worldToCanvasCoords(shipsLocation);
        const artifactSizePixels = 20;
        const x = 4 + artifactSizePixels / 2 + screenCoords.x;
        const y = screenCoords.y;
        sR.queueArtifact(artifact, { x, y }, artifactSizePixels);
      }
    }

    if (this.isHoveredAt(shipsLocation)) {
      const etaSec = Math.max(
        Math.ceil((entry.targetArrivalMs - displayNowMs) / 1000),
        0,
      );
      tR.queueTextWorld(
        this.renderer.context.getDisplayTimeStale()
          ? "syncing..."
          : etaSec > 0
            ? `${etaSec}s (confirming)`
            : "confirming...",
        { x: shipsLocation.x, y: shipsLocation.y - 0.5 },
        [...white, 255],
        0,
        TextAlign.Center,
        TextAnchor.Top,
      );
    }
  }

  drawFleet(
    voyage: QueuedArrival,
    _player: Player | undefined,
    isMyVoyage: boolean,
    isShipVoyage: boolean,
  ) {
    const {
      now: nowMs,
      context: gameUIManager,
      circleRenderer: cR,
      textRenderer: tR,
      spriteRenderer: sR,
    } = this.renderer;

    const fromLoc = gameUIManager.getLocationOfPlanet(voyage.fromPlanet);
    const fromPlanet = gameUIManager.getPlanetWithId(voyage.fromPlanet);
    const toLoc = gameUIManager.getLocationOfPlanet(voyage.toPlanet);
    const toPlanet = gameUIManager.getPlanetWithId(voyage.toPlanet);
    if (!fromPlanet || !toLoc) {
      // not enough info to draw anything
      return;
    } else if (!fromLoc && fromPlanet && toLoc && toPlanet) {
      // can draw a ring around dest, but don't know source location
      const myMove = voyage.player === gameUIManager.getAccount();
      const shipMove = voyage.player === EMPTY_ADDRESS;
      const now = nowMs / 1000;
      // Display time can reach the arrival moment before the chain matures
      // the arrival; hold at "arriving" instead of going negative.
      const timeLeft = Math.max(voyage.arrivalTime - now, 0);
      const radius = (timeLeft * fromPlanet.speed) / 100;
      const color = getVoyageColor(fromPlanet, toPlanet, myMove, shipMove);

      const text = shipMove ? "Ship" : `${Math.floor(voyage.energyArriving)}`;
      const eta = this.renderer.context.getDisplayTimeStale()
        ? "syncing..."
        : timeLeft > 0
          ? `in ${Math.floor(timeLeft)}s`
          : "arriving...";

      cR.queueCircleWorld(toLoc.coords, radius, color, 0.7, 1, true);
      tR.queueTextWorld(
        `${text} ${eta}`,
        { x: toLoc.coords.x, y: toLoc.coords.y + radius },
        color,
        undefined,
        TextAlign.Center,
        TextAnchor.Bottom,
      );
    } else if (fromLoc && fromPlanet && toLoc && toPlanet) {
      // know source and destination locations

      const now = nowMs / 1000;
      let proportion =
        (now - voyage.departureTime) /
        (voyage.arrivalTime - voyage.departureTime);
      // Zero-duration voyages can yield 0/0 now that held (past-arrival)
      // voyages are still drawn.
      if (!Number.isFinite(proportion)) proportion = 0.99;
      // Default ETA runs to the chain arrival on display time.
      let etaSeconds = Math.max(Math.ceil(voyage.arrivalTime - now), 0);
      // Hold condition is set per rendering mode below so dot position,
      // ETA, and hold state can never disagree.
      let held = etaSeconds === 0;
      // A voyage that had an optimistic dot follows its visual schedule:
      // dot and ETA agree, and the deadline never outlives maturation.
      const schedule = this.scheduleByArrivalId.get(voyage.eventId);
      if (schedule?.mode === "linear") {
        const spanMs = schedule.deadlineMs - schedule.d0Ms;
        const u =
          spanMs > 0
            ? Math.min(Math.max((nowMs - schedule.d0Ms) / spanMs, 0), 1)
            : 1;
        proportion = schedule.p0 + (0.99 - schedule.p0) * u;
        etaSeconds = Math.max(
          Math.ceil((schedule.deadlineMs - nowMs) / 1000),
          0,
        );
        held = nowMs >= schedule.deadlineMs;
      } else if (schedule?.mode === "trace") {
        // Sweep from fromP to the TRUE position, then hand over to
        // honest rendering (ETA stays truthful throughout).
        const u = Math.min(
          Math.max(
            (this.renderer.naturalNow - schedule.glideStartWallMs) / TRACE_MS,
            0,
          ),
          1,
        );
        if (u >= 1) {
          this.scheduleByArrivalId.delete(voyage.eventId);
        } else {
          proportion =
            schedule.fromP + (proportion - schedule.fromP) * (1 - (1 - u) ** 3);
        }
      }
      proportion = Math.max(proportion, 0.01);
      proportion = Math.min(proportion, 0.99);

      const shipsLocationX =
        (1 - proportion) * fromLoc.coords.x + proportion * toLoc.coords.x;
      const shipsLocationY =
        (1 - proportion) * fromLoc.coords.y + proportion * toLoc.coords.y;
      const shipsLocation = { x: shipsLocationX, y: shipsLocationY };

      const timeLeftSeconds = etaSeconds;
      const hovered = this.isHoveredAt(shipsLocation);

      if (held) {
        this.heldVoyages.add(voyage.eventId);
      } else {
        this.heldVoyages.delete(voyage.eventId);
      }

      // Clone: getVoyageColor returns shared module-level arrays, and we
      // mutate alpha below — mutating the shared array leaks one
      // voyage's alpha into every other consumer.
      const voyageColor = [
        ...getVoyageColor(fromPlanet, toPlanet, isMyVoyage, isShipVoyage),
      ] as [number, number, number, number];

      // alpha calculation
      const viewport = this.renderer.getViewport();
      const dx = fromLoc.coords.x - toLoc.coords.x;
      const dy = fromLoc.coords.y - toLoc.coords.y;
      const distWorld = Math.sqrt(dx ** 2 + dy ** 2);
      const dist = viewport.worldToCanvasDist(distWorld);
      let alpha = 255;
      if (dist < 300) {
        alpha = (dist / 300) * 255;
      }

      voyageColor[3] = alpha;
      // Snapshot render facts for terminal-ghost spawning if canonical
      // state matures while this dot is still mid-flight.
      this.lastVoyageFrame.set(voyage.eventId, {
        fromCoords: { x: fromLoc.coords.x, y: fromLoc.coords.y },
        toCoords: { x: toLoc.coords.x, y: toLoc.coords.y },
        proportion,
        color: [voyageColor[0], voyageColor[1], voyageColor[2], 255],
        planetLevel: toPlanet.planetLevel,
        isForeign: !isMyVoyage,
      });
      const fleetRadius = 4;
      const artifactSizePixels = 20;
      if (held) {
        // Landing beacon: two thin dashed white strips collapsing into
        // the planet (the game's range-ring vocabulary). The fleet dot
        // and sprite dock out of sight; the beacon IS the arrival state.
        // Deduped per destination — several fleets holding at one planet
        // share one beacon and one label ("arriving... xN").
        const prev = this.beaconsThisFrame.get(voyage.toPlanet);
        this.beaconsThisFrame.set(voyage.toPlanet, {
          center: toLoc.coords,
          toPlanet,
          alpha: Math.max(alpha, prev?.alpha ?? 0),
          count: (prev?.count ?? 0) + 1,
          hovered: (prev?.hovered ?? false) || this.isHoveredAt(toLoc.coords),
        });
      } else {
        cR.queueCircleWorldCenterOnly(shipsLocation, fleetRadius, voyageColor);
        if (voyage.artifactId) {
          const artifact = gameUIManager.getArtifactWithId(voyage.artifactId);
          if (artifact) {
            const viewport = this.renderer.getViewport();
            const screenCoords = viewport.worldToCanvasCoords(shipsLocation);
            const distanceFromCenterOfFleet =
              fleetRadius + artifactSizePixels / 2;
            const x = distanceFromCenterOfFleet + screenCoords.x;
            const y = screenCoords.y;
            sR.queueArtifact(artifact, { x, y }, artifactSizePixels);
          }
        }
      }

      // ETA and cargo text only on hover, keeping the moving fleet clean.
      // Held voyages draw NO per-voyage text — the shared per-planet
      // beacon label covers them (several holds = one "arriving... xN").
      if (hovered && !held) {
        tR.queueTextWorld(
          this.renderer.context.getDisplayTimeStale()
            ? "syncing..."
            : `${timeLeftSeconds.toString()}s`,
          {
            x: shipsLocationX,
            y: shipsLocationY - 0.5,
          },
          [...white, alpha],
          0,
          TextAlign.Center,
          TextAnchor.Top,
        );
        if (!held && voyage.energyArriving > 0) {
          tR.queueTextWorld(
            `${formatNumber(voyage.energyArriving)}`,
            {
              x: shipsLocationX,
              y: shipsLocationY + 0.5,
            },
            [...white, alpha],
            -0,
            TextAlign.Center,
            TextAnchor.Bottom,
          );
        }
        if (!held && voyage.silverMoved > 0) {
          tR.queueTextWorld(
            `${formatNumber(voyage.silverMoved)}`,
            {
              x: shipsLocationX,
              y: shipsLocationY + 0.5,
            },
            [...gold, alpha],
            -1,
            TextAlign.Center,
            TextAnchor.Bottom,
          );
        }
      }
    }
  }

  queueVoyages(): void {
    this.renderer.artifactsInFlight.clear();
    // Display clock not initialized (boot syncs failed): there is no
    // sensible time base to draw voyage motion from.
    if (this.renderer.now <= 0) return;
    const { context: gameUIManager } = this.renderer;
    const voyages = gameUIManager.getAllVoyages();
    const unconfirmedDepartures = gameUIManager.getUnconfirmedMoves();
    this.beaconsThisFrame.clear();

    this.reconcileOptimistic(
      this.renderer.now,
      this.renderer.naturalNow,
      voyages,
      unconfirmedDepartures,
    );
    this.assignEntryAnimations(voyages);

    // Suppress SOURCE-planet orbit icons for artifacts currently flying
    // on an optimistic dot (planets queue after voyages this frame).
    for (const entry of this.optimisticByTxId.values()) {
      if (entry.artifactId) {
        this.renderer.artifactsInFlight.set(entry.artifactId, entry.from);
      }
    }

    // Voyages removed from canonical state: log hold exits, drop their
    // schedules, spawn a terminal ghost for any dot still mid-flight,
    // and fire an arrival flash for foreign landings.
    const liveIds = new Set(voyages.map((v) => v.eventId));
    for (const id of this.heldVoyages) {
      if (!liveIds.has(id)) {
        this.heldVoyages.delete(id);
      }
    }
    // Prune per-voyage state directly (never-drawn voyages — e.g.
    // ring-only, unknown source — have no lastVoyageFrame entry).
    for (const id of this.seenVoyageIds) {
      if (!liveIds.has(id)) this.seenVoyageIds.delete(id);
    }
    for (const id of this.scheduleByArrivalId.keys()) {
      if (!liveIds.has(id)) this.scheduleByArrivalId.delete(id);
    }
    for (const [id, frame] of this.lastVoyageFrame) {
      if (liveIds.has(id)) continue;
      this.lastVoyageFrame.delete(id);
      this.scheduleByArrivalId.delete(id);
      this.seenVoyageIds.delete(id);
      const flash: ArrivalFlash | undefined = frame.isForeign
        ? {
            center: frame.toCoords,
            planetLevel: frame.planetLevel,
            startWallMs: this.renderer.naturalNow,
            color: frame.color,
          }
        : undefined;
      if (frame.proportion < 0.989) {
        this.ghosts.push({
          fromCoords: frame.fromCoords,
          toCoords: frame.toCoords,
          p0: frame.proportion,
          glideStartWallMs: this.renderer.naturalNow,
          color: frame.color,
          flashOnComplete: flash,
        });
      } else if (flash) {
        this.pushFlash(flash);
      }
    }

    for (const voyage of voyages) {
      // Draw every voyage still present in game state: display time can
      // pass arrivalTime before the chain matures the arrival, and the
      // fleet should hold at the destination ("arriving...") until then.
      // Matured arrivals are removed from state, which ends rendering.
      const isMyVoyage =
        voyage.player === gameUIManager.getAccount() ||
        gameUIManager.getArtifactWithId(voyage.artifactId)?.controller ===
          gameUIManager.getPlayer()?.address;
      const isShipVoyage = voyage.player === EMPTY_ADDRESS;
      const sender = gameUIManager.getPlayer(voyage.player);
      this.drawVoyagePath(
        voyage.fromPlanet,
        voyage.toPlanet,
        true,
        isMyVoyage,
        isShipVoyage,
        // One-frame lag on hold state is imperceptible here.
        this.heldVoyages.has(voyage.eventId),
      );
      this.drawFleet(voyage, sender, isMyVoyage, isShipVoyage);
    }

    for (const unconfirmedMove of unconfirmedDepartures) {
      this.drawVoyagePath(
        unconfirmedMove.intent.from,
        unconfirmedMove.intent.to,
        false,
        true,
        // This false doesn't matter because we force isMyVoyage to true
        false,
      );
    }

    for (const entry of this.optimisticByTxId.values()) {
      this.drawOptimisticFleet(entry);
    }

    for (const beacon of this.beaconsThisFrame.values()) {
      this.drawLandingBeacon(beacon.center, beacon.toPlanet, beacon.alpha);
      if (beacon.hovered) {
        const label = gameUIManager.getDisplayTimeStale()
          ? "syncing..."
          : beacon.count > 1
            ? `arriving... x${beacon.count}`
            : "arriving...";
        this.renderer.textRenderer.queueTextWorld(
          label,
          { x: beacon.center.x, y: beacon.center.y - 0.5 },
          [...white, 255],
          0,
          TextAlign.Center,
          TextAnchor.Top,
        );
      }
    }
    this.drawGhosts();
    this.drawArrivalFlashes();
  }

  /**
   * Entry policy for voyages first appearing in canonical state (beauty
   * by default, honesty when it's your skin):
   * - inbound to the viewer's own planet → "trace": fast sweep from the
   *   source to the TRUE position, then honest rendering (a defender's
   *   glance must never understate an incoming attack);
   * - spectated (neither planet the viewer's) → full departure→arrival
   *   flight over the remaining time (position is theater there);
   * - voyages already known (own optimistic schedules), present at
   *   session start, nearly-arrived, or without both locations: exempt.
   */
  private assignEntryAnimations(voyages: QueuedArrival[]): void {
    const ctx = this.renderer.context;
    if (!this.bootstrapped) {
      for (const v of voyages) this.seenVoyageIds.add(v.eventId);
      this.bootstrapped = true;
      return;
    }
    const displayNowMs = this.renderer.now;
    if (displayNowMs <= 0) return;
    const account = ctx.getAccount();
    for (const v of voyages) {
      if (this.seenVoyageIds.has(v.eventId)) continue;
      this.seenVoyageIds.add(v.eventId);
      if (this.scheduleByArrivalId.has(v.eventId)) continue; // own optimistic
      const fromLoc = ctx.getLocationOfPlanet(v.fromPlanet);
      const toLoc = ctx.getLocationOfPlanet(v.toPlanet);
      if (!fromLoc || !toLoc) continue; // ring-only case, nothing to animate
      const arrivalMs = v.arrivalTime * 1000;
      const toPlanet = ctx.getPlanetWithId(v.toPlanet);
      const inboundToMe = account !== undefined && toPlanet?.owner === account;
      if (inboundToMe) {
        // Untranslated guard: a nearly-landed attack renders honestly at
        // once — no theatrical sweep for something about to strike.
        if (arrivalMs - displayNowMs < MIN_SCHEDULE_RUNWAY_MS) continue;
        this.scheduleByArrivalId.set(v.eventId, {
          mode: "trace",
          glideStartWallMs: this.renderer.naturalNow,
          fromP: 0.01,
        });
      } else {
        // Display-base target (see displayArrivalMs): the flight ends
        // when maturation can actually land, not a display-lead early.
        const targetMs = this.displayArrivalMs(arrivalMs);
        if (targetMs - displayNowMs < MIN_SCHEDULE_RUNWAY_MS) continue;
        this.scheduleByArrivalId.set(v.eventId, {
          mode: "linear",
          d0Ms: displayNowMs,
          p0: 0.01,
          deadlineMs: targetMs,
        });
      }
    }
  }

  /**
   * Landing beacon (toned-down): two thin dashed strips collapsing into
   * the planet on a slow cycle. Zoom-faded via the caller's alpha.
   */
  private drawLandingBeacon(
    center: { x: number; y: number },
    toPlanet: Planet,
    zoomAlpha: number,
  ): void {
    const cR = this.renderer.circleRenderer;
    const planetR = this.renderer.context.getRadiusOfPlanetLevel(
      toPlanet.planetLevel,
    );
    // Skip when the planet is sub-pixel scale — rings would be noise.
    if (this.renderer.getViewport().worldToCanvasDist(planetR) < 3) return;
    const wall = this.renderer.naturalNow;
    const CYCLE_MS = 4_000;
    const PEAK_ALPHA = 110;
    for (let k = 0; k < 2; k++) {
      const phase = ((wall + (k * CYCLE_MS) / 2) % CYCLE_MS) / CYCLE_MS;
      // Ease-in collapse from 2.6R to just outside the planet rim.
      const radius = planetR * (1.1 + 1.5 * (1 - phase * phase));
      const ramp = phase < 0.15 ? phase / 0.15 : (1 - phase) / 0.85;
      const a = Math.round(PEAK_ALPHA * ramp * (zoomAlpha / 255));
      if (a <= 0) continue;
      cR.queueCircleWorld(center, radius, [255, 255, 255, a], 1, 1, true);
    }
  }

  /** Ease early-matured dots into their destination, then forget them. */
  private drawGhosts(): void {
    if (this.ghosts.length === 0) return;
    const wallNow = this.renderer.naturalNow;
    const cR = this.renderer.circleRenderer;
    this.ghosts = this.ghosts.filter((ghost) => {
      const u = Math.min(
        Math.max((wallNow - ghost.glideStartWallMs) / GLIDE_MS, 0),
        1,
      );
      if (u >= 1) {
        if (ghost.flashOnComplete) {
          this.pushFlash({ ...ghost.flashOnComplete, startWallMs: wallNow });
        }
        return false;
      }
      const p = ghost.p0 + (0.99 - ghost.p0) * (1 - (1 - u) ** 3);
      const color = [...ghost.color] as [number, number, number, number];
      // Same zoom fade as live voyages: short paths dim when zoomed out.
      color[3] = this.zoomAlphaFor(ghost.fromCoords, ghost.toCoords);
      // Keep a fading path line under the gliding dot — the voyage left
      // canonical state, but its line vanishing a beat before the dot
      // lands reads as a glitch.
      this.renderer.lineRenderer.queueLineWorld(
        ghost.fromCoords,
        ghost.toCoords,
        [color[0], color[1], color[2], Math.round(color[3] * (1 - u) * 0.5)],
        1,
        RenderZIndex.Voyages,
        false,
      );
      cR.queueCircleWorldCenterOnly(
        {
          x: (1 - p) * ghost.fromCoords.x + p * ghost.toCoords.x,
          y: (1 - p) * ghost.fromCoords.y + p * ghost.toCoords.y,
        },
        4,
        color,
      );
      return true;
    });
  }

  /** The voyage zoom-fade rule (short canvas paths dim), reusable. */
  private zoomAlphaFor(
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): number {
    const viewport = this.renderer.getViewport();
    const dist = viewport.worldToCanvasDist(
      Math.hypot(from.x - to.x, from.y - to.y),
    );
    return dist < 300 ? (dist / 300) * 255 : 255;
  }

  /** Queue a flash unless one is already active at the same destination. */
  private pushFlash(flash: ArrivalFlash): void {
    const duplicate = this.flashes.some(
      (f) => f.center.x === flash.center.x && f.center.y === flash.center.y,
    );
    if (!duplicate) this.flashes.push(flash);
  }

  /** One-shot double-ring beacon at planets that just received arrivals. */
  private drawArrivalFlashes(): void {
    if (this.flashes.length === 0) return;
    const wallNow = this.renderer.naturalNow;
    const cR = this.renderer.circleRenderer;
    const ctx = this.renderer.context;
    this.flashes = this.flashes.filter((flash) => {
      const u = (wallNow - flash.startWallMs) / FLASH_MS;
      if (u >= 1) return false;
      const planetR = ctx.getRadiusOfPlanetLevel(flash.planetLevel);
      // Sub-pixel planets: let the flash age out without drawing.
      if (this.renderer.getViewport().worldToCanvasDist(planetR) < 3)
        return true;
      for (let k = 0; k < 2; k++) {
        const phase = Math.min(Math.max(u * 1.3 - k * 0.3, 0), 1);
        if (phase <= 0 || phase >= 1) continue;
        const radius = planetR * (1.1 + 1.6 * (1 - phase * phase));
        const ramp = phase < 0.2 ? phase / 0.2 : (1 - phase) / 0.8;
        const a = Math.round(150 * ramp);
        if (a <= 0) continue;
        cR.queueCircleWorld(
          flash.center,
          radius,
          [flash.color[0], flash.color[1], flash.color[2], a],
          1,
          1,
          true,
        );
      }
      return true;
    });
  }

  private drawVoyagePath(
    from: LocationId,
    to: LocationId,
    confirmed: boolean,
    isMyVoyage: boolean,
    isShipVoyage: boolean,
    dimmed = false,
  ) {
    const { context: gameUIManager } = this.renderer;

    const fromLoc = gameUIManager.getLocationOfPlanet(from);
    const fromPlanet = gameUIManager.getPlanetWithId(from);
    const toLoc = gameUIManager.getLocationOfPlanet(to);
    const toPlanet = gameUIManager.getPlanetWithId(to);
    if (!fromPlanet || !fromLoc || !toLoc || !toPlanet) {
      return;
    }

    const voyageColor = getVoyageColor(
      fromPlanet,
      toPlanet,
      isMyVoyage,
      isShipVoyage,
    );
    // Held voyages fade their path: the landing beacon carries the state.
    const lineColor: [number, number, number, number] = [
      voyageColor[0],
      voyageColor[1],
      voyageColor[2],
      dimmed ? 90 : 255,
    ];

    this.renderer.lineRenderer.queueLineWorld(
      fromLoc.coords,
      toLoc.coords,
      lineColor,
      confirmed ? 2 : 1,
      RenderZIndex.Voyages,
      confirmed ? false : true,
    );
  }

  // eslint-disable-next-line
  flush() {}
}
