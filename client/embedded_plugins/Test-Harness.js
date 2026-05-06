/**
 * Test Harness — Continuous automated game tests + metrics + event heartbeats.
 * Embedded plugin for dfpunk-aztec. Uses globals df + ui only (no CDN).
 *
 * WARNING: Sends real transactions when enabled (move, reveal, prospect, findArtifact, withdrawSilver).
 * Keep the modal open for monitoring; close or disable master switch to stop new txs.
 */

const PlanetType = {
  PLANET: 0,
  SILVER_MINE: 1,
  RUINS: 2,
  TRADING_POST: 3,
  SILVER_BANK: 4,
};

const LOG_MAX = 100;
const DEFAULT_MASTER_MS = 2000;
const DEFAULT_MOVE_COOLDOWN_MS = 60000;
const DEFAULT_TEST_COOLDOWN_MS = 45000;
const TX_CONFIRM_TIMEOUT_MS = 180000;
const EVENT_STALE_MS = 60000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function confirmTx(tx, timeoutMs = TX_CONFIRM_TIMEOUT_MS) {
  if (!tx?.confirmedPromise) {
    return { ok: true, detail: "(no confirmedPromise)" };
  }
  try {
    await Promise.race([
      tx.confirmedPromise,
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error("confirmation timeout")), timeoutMs)
      ),
    ]);
    return { ok: true, detail: "confirmed" };
  } catch (e) {
    return { ok: false, detail: e?.message ?? String(e) };
  }
}

function isLocatablePlanet(p) {
  return !!(p?.location?.coords && p.locationId);
}

function fmtAddr(a) {
  if (!a) return "(none)";
  const s = String(a);
  return s.length > 14 ? `${s.slice(0, 8)}…${s.slice(-4)}` : s;
}

function fmtMs(ms) {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms <= 0) return "now";
  return `${Math.ceil(ms / 1000)}s`;
}

export default class Plugin {
  #destroyed = false;
  #root = null;
  #intervalId = null;
  #rafId = null;
  #subs = [];
  #runLock = false;

  /** @type {{ ts: number; level: string; msg: string }[]} */
  #log = [];
  #fpsFrames = 0;
  #fpsLastStamp = 0;
  #measuredFps = 0;

  /** metrics snapshot */
  #metrics = {};

  /** heartbeat ages */
  #hb = {
    players: null,
    planet: null,
    paused: null,
    selected: null,
    lastPausedValue: undefined,
  };

  /** settings (mutable from UI) */
  #settings = {
    masterEnabled: true,
    masterIntervalMs: DEFAULT_MASTER_MS,
    energyMinPct: 75,
    sendPct: 10,
    moveCooldownMs: DEFAULT_MOVE_COOLDOWN_MS,
    testCooldownMs: DEFAULT_TEST_COOLDOWN_MS,
    silverMin: 10,
    staleThresholdMs: EVENT_STALE_MS,
    enableMove: true,
    enableReveal: true,
    enableProspectFind: true,
    enableWithdrawSilver: true,
  };

  /** per-test state */
  #tests = {
    move: {
      id: "move",
      label: "Move (own → own)",
      lastRunAt: 0,
      lastResult: "",
      runs: 0,
      passes: 0,
      fails: 0,
    },
    reveal: {
      id: "reveal",
      label: "Reveal location",
      lastRunAt: 0,
      lastResult: "",
      runs: 0,
      passes: 0,
      fails: 0,
    },
    prospectFind: {
      id: "prospectFind",
      label: "Prospect + find artifact",
      lastRunAt: 0,
      lastResult: "",
      runs: 0,
      passes: 0,
      fails: 0,
    },
    withdrawSilver: {
      id: "withdrawSilver",
      label: "Withdraw silver (rip)",
      lastRunAt: 0,
      lastResult: "",
      runs: 0,
      passes: 0,
      fails: 0,
    },
  };

  log(level, msg) {
    const entry = { ts: Date.now(), level, msg };
    this.#log.push(entry);
    while (this.#log.length > LOG_MAX) this.#log.shift();
    const prefix =
      level === "error"
        ? "[test-harness:error]"
        : level === "warn"
          ? "[test-harness:warn]"
          : "[test-harness]";
    console.log(prefix, msg);
    this.#renderLog();
  }

  #subscribe(stream, label, onVal) {
    const sub = stream?.subscribe?.((v) => {
      const now = Date.now();
      if (label === "players") this.#hb.players = now;
      else if (label === "planet") this.#hb.planet = now;
      else if (label === "paused") {
        this.#hb.paused = now;
        this.#hb.lastPausedValue = v;
      } else if (label === "selected") this.#hb.selected = now;
      onVal?.(v);
    });
    if (sub) this.#subs.push(sub);
  }

  #heartbeatLabel(lastTs, now) {
    if (lastTs == null) return { text: "NEVER", cls: "th-never" };
    const age = now - lastTs;
    if (age > this.#settings.staleThresholdMs)
      return { text: `STALE (${Math.round(age / 1000)}s)`, cls: "th-stale" };
    return { text: `OK (${Math.round(age / 1000)}s)`, cls: "th-ok" };
  }

  #collectMetrics() {
    const mem = window.performance?.memory;
    const chainMs =
      typeof df.getChainTimeMs === "function" ? df.getChainTimeMs() : null;
    const skew =
      chainMs != null ? Math.round(Date.now() - Number(chainMs)) : null;

    const moves = df.getUnconfirmedMoves?.() ?? [];
    let oldestAge = 0;
    for (const tx of moves) {
      const t = tx?.intent?.uiTimestamp;
      if (typeof t === "number") {
        const age = Date.now() / 1000 - t;
        if (age > oldestAge) oldestAge = age;
      }
    }

    this.#metrics = {
      fps: this.#measuredFps,
      heapUsedMb:
        mem && typeof mem.usedJSHeapSize === "number"
          ? Math.round(mem.usedJSHeapSize / (1024 * 1024))
          : null,
      heapLimitMb:
        mem && typeof mem.jsHeapSizeLimit === "number"
          ? Math.round(mem.jsHeapSizeLimit / (1024 * 1024))
          : null,
      hashRate:
        typeof df.getHashesPerSec === "function" ? df.getHashesPerSec() : null,
      mining: df.isMining?.() ?? false,
      exploreChunk: df.getCurrentlyExploringChunk?.(),
      unconfirmedMoves: moves.length,
      unconfirmedOldestSec: oldestAge,
      chainSkewMs: skew,
      balance:
        typeof df.getMyBalance === "function"
          ? df.getMyBalance().toString()
          : null,
      uiBalance:
        typeof ui.getMyBalance === "function" ? ui.getMyBalance() : null,
      myPlanets: df.getMyPlanets?.()?.length ?? 0,
      myArtifacts: df.getMyArtifacts?.()?.length ?? 0,
      players: df.getAllPlayers?.()?.length ?? 0,
      roundOver: df.isRoundOver?.() ?? false,
      paused: df.getPaused?.() ?? false,
      account: df.getAccount?.(),
    };
  }

  #gameBlocked() {
    if (df.isRoundOver?.()) return "round over";
    if (df.getPaused?.()) return "paused";
    if (!df.getAccount?.()) return "no account";
    return null;
  }

  #cooldownOk(testRow, customMs) {
    const ms = customMs ?? this.#settings.testCooldownMs;
    return Date.now() - testRow.lastRunAt >= ms;
  }

  #pendingMoveOnPlanet(locationId) {
    const moves = df.getUnconfirmedMoves?.() ?? [];
    return moves.some(
      (tx) => tx?.intent?.from === locationId || tx?.intent?.to === locationId
    );
  }

  #pickMovePair() {
    const planets = df.getMyPlanets?.() ?? [];
    const loc = planets.filter((p) => isLocatablePlanet(p));
    if (loc.length < 2) return null;

    let best = null;
    for (const a of loc) {
      const ep = Math.floor((a.energy / Math.max(1, a.energyCap)) * 100);
      if (ep < this.#settings.energyMinPct) continue;

      for (const b of loc) {
        if (a.locationId === b.locationId) continue;
        const dist = df.getDist(a.locationId, b.locationId);
        let forces = Math.floor((a.energyCap * this.#settings.sendPct) / 100);
        forces = Math.min(forces, Math.floor(a.energy * 0.95));
        if (forces < 1) continue;

        let arriving = 0;
        try {
          arriving = df.getEnergyArrivingForMove(
            a.locationId,
            b.locationId,
            dist,
            forces,
            false
          );
        } catch {
          arriving = 0;
        }
        if (arriving <= 0) continue;

        const score = dist;
        if (!best || score < best.dist) best = { from: a, to: b, dist, forces };
      }
    }
    return best;
  }

  async #runMove() {
    const row = this.#tests.move;
    if (!this.#cooldownOk(row, this.#settings.moveCooldownMs)) {
      return { skipped: true, msg: "cooldown" };
    }
    const pair = this.#pickMovePair();
    if (!pair) {
      return { skipped: true, msg: "no suitable owned pair / range" };
    }
    if (
      this.#pendingMoveOnPlanet(pair.from.locationId) ||
      this.#pendingMoveOnPlanet(pair.to.locationId)
    ) {
      return { skipped: true, msg: "pending move on planet" };
    }

    const tx = await df.move(
      pair.from.locationId,
      pair.to.locationId,
      pair.forces,
      0,
      undefined,
      false,
      false,
      undefined
    );
    const c = await confirmTx(tx);
    if (!c.ok) return { ok: false, msg: `move: ${c.detail}` };
    return {
      ok: true,
      msg: `move ${fmtAddr(pair.from.locationId)}→${fmtAddr(pair.to.locationId)} forces=${pair.forces}`,
    };
  }

  async #runReveal() {
    const row = this.#tests.reveal;
    let cooldownMs = 0;
    try {
      cooldownMs = df.timeUntilNextBroadcastAvailable?.() ?? 0;
    } catch (e) {
      return { skipped: true, msg: `broadcast cooldown: ${e?.message ?? e}` };
    }
    if (cooldownMs > 0) {
      return { skipped: true, msg: `broadcast in ${fmtMs(cooldownMs)}` };
    }

    const planets = df.getMyPlanets?.() ?? [];
    const target = planets.find(
      (p) => isLocatablePlanet(p) && !p.coordsRevealed
    );
    if (!target) {
      return { skipped: true, msg: "no unrevealed locatable planet" };
    }
    if (!this.#cooldownOk(row)) {
      return { skipped: true, msg: "cooldown" };
    }

    const tx = await df.revealLocation(target.locationId);
    const c = await confirmTx(tx);
    if (!c.ok) return { ok: false, msg: `reveal: ${c.detail}` };
    return { ok: true, msg: `reveal ${fmtAddr(target.locationId)}` };
  }

  async #runProspectFind() {
    const row = this.#tests.prospectFind;
    if (!this.#cooldownOk(row)) {
      return { skipped: true, msg: "cooldown" };
    }

    const ruins = (df.getMyPlanets?.() ?? []).filter(
      (p) =>
        p.planetType === PlanetType.RUINS &&
        isLocatablePlanet(p) &&
        p.owner === df.getAccount?.()
    );
    if (!ruins.length) {
      return { skipped: true, msg: "no owned RUINS planet" };
    }

    for (const planet of ruins) {
      const fresh = df.getPlanetWithId(planet.locationId) ?? planet;
      const done =
        fresh.prospectedBlockNumber !== undefined &&
        fresh.hasTriedFindingArtifact;
      if (done) continue;

      if (fresh.prospectedBlockNumber === undefined) {
        const tx = await df.prospectPlanet(fresh.locationId);
        const c = await confirmTx(tx);
        if (!c.ok) return { ok: false, msg: `prospect: ${c.detail}` };
        return { ok: true, msg: `prospect ${fmtAddr(fresh.locationId)}` };
      }

      if (!fresh.hasTriedFindingArtifact) {
        const tx = await df.findArtifact(fresh.locationId);
        const c = await confirmTx(tx);
        if (!c.ok) return { ok: false, msg: `findArtifact: ${c.detail}` };
        return { ok: true, msg: `findArtifact ${fmtAddr(fresh.locationId)}` };
      }
    }

    return { skipped: true, msg: "no RUINS needing prospect/find" };
  }

  async #runWithdrawSilver() {
    const row = this.#tests.withdrawSilver;
    const rips = (df.getMyPlanets?.() ?? []).filter(
      (p) =>
        p.planetType === PlanetType.TRADING_POST &&
        isLocatablePlanet(p) &&
        p.owner === df.getAccount?.() &&
        p.silver >= this.#settings.silverMin
    );
    const p = rips.sort((a, b) => b.silver - a.silver)[0];
    if (!p) {
      return {
        skipped: true,
        msg: `no TRADING_POST with ≥${this.#settings.silverMin} silver`,
      };
    }
    if (!this.#cooldownOk(row)) {
      return { skipped: true, msg: "cooldown" };
    }

    const amount = Math.min(
      Math.max(1, Math.floor(this.#settings.silverMin)),
      Math.floor(p.silver)
    );
    const tx = await df.withdrawSilver(p.locationId, amount);
    const c = await confirmTx(tx);
    if (!c.ok) return { ok: false, msg: `withdrawSilver: ${c.detail}` };
    return {
      ok: true,
      msg: `withdraw ${amount} silver @ ${fmtAddr(p.locationId)}`,
    };
  }

  async #runOneEligibleTest() {
    const order = [
      ["move", this.#settings.enableMove, () => this.#runMove()],
      ["reveal", this.#settings.enableReveal, () => this.#runReveal()],
      [
        "prospectFind",
        this.#settings.enableProspectFind,
        () => this.#runProspectFind(),
      ],
      [
        "withdrawSilver",
        this.#settings.enableWithdrawSilver,
        () => this.#runWithdrawSilver(),
      ],
    ];

    for (const [key, enabled, fn] of order) {
      if (!enabled) continue;
      const row = this.#tests[key];
      try {
        const result = await fn();
        if (result.skipped) continue;

        row.lastRunAt = Date.now();
        row.runs++;
        row.lastResult = result.msg ?? "";
        if (result.ok) {
          row.passes++;
          this.log("info", `${row.label}: PASS ${result.msg}`);
        } else {
          row.fails++;
          this.log("error", `${row.label}: FAIL ${result.msg}`);
        }
        return;
      } catch (e) {
        row.lastRunAt = Date.now();
        row.runs++;
        row.fails++;
        row.lastResult = e?.message ?? String(e);
        this.log("error", `${row.label}: FAIL ${row.lastResult}`);
        return;
      }
    }
  }

  #tick = async () => {
    if (this.#destroyed || !this.#root) return;

    this.#collectMetrics();
    this.#renderMetrics();
    this.#renderHeartbeats();
    this.#renderTestRows();

    if (!this.#settings.masterEnabled || this.#runLock) return;

    const blocked = this.#gameBlocked();
    if (blocked) return;

    this.#runLock = true;
    try {
      await this.#runOneEligibleTest();
    } finally {
      this.#runLock = false;
    }
  };

  #startRaf() {
    const loop = (ts) => {
      if (this.#destroyed) return;
      if (!this.#fpsLastStamp) this.#fpsLastStamp = ts;
      this.#fpsFrames++;
      const elapsed = ts - this.#fpsLastStamp;
      if (elapsed >= 1000) {
        this.#measuredFps = Math.round((this.#fpsFrames * 1000) / elapsed);
        this.#fpsFrames = 0;
        this.#fpsLastStamp = ts;
      }
      this.#rafId = requestAnimationFrame(loop);
    };
    this.#rafId = requestAnimationFrame(loop);
  }

  #bindControls() {
    const q = (sel) => this.#root.querySelector(sel);

    const master = q("[data-th-master]");
    const interval = q("[data-th-interval]");
    const energy = q("[data-th-energy]");
    const send = q("[data-th-send]");
    const moveCd = q("[data-th-move-cd]");
    const testCd = q("[data-th-test-cd]");
    const silverMin = q("[data-th-silver]");
    const stale = q("[data-th-stale]");
    const enMove = q("[data-th-en-move]");
    const enReveal = q("[data-th-en-reveal]");
    const enPF = q("[data-th-en-pf]");
    const enW = q("[data-th-en-wd]");

    const sync = () => {
      if (master) master.checked = this.#settings.masterEnabled;
      if (interval) interval.value = String(this.#settings.masterIntervalMs);
      if (energy) energy.value = String(this.#settings.energyMinPct);
      if (send) send.value = String(this.#settings.sendPct);
      if (moveCd) moveCd.value = String(this.#settings.moveCooldownMs);
      if (testCd) testCd.value = String(this.#settings.testCooldownMs);
      if (silverMin) silverMin.value = String(this.#settings.silverMin);
      if (stale) stale.value = String(this.#settings.staleThresholdMs);
      if (enMove) enMove.checked = this.#settings.enableMove;
      if (enReveal) enReveal.checked = this.#settings.enableReveal;
      if (enPF) enPF.checked = this.#settings.enableProspectFind;
      if (enW) enW.checked = this.#settings.enableWithdrawSilver;
    };

    master?.addEventListener("change", () => {
      this.#settings.masterEnabled = !!master.checked;
      this.log("info", `master ${this.#settings.masterEnabled ? "ON" : "OFF"}`);
    });

    const applyNumber = (el, key, min, max) => {
      el?.addEventListener("change", () => {
        let v = Number(el.value);
        if (!Number.isFinite(v)) return;
        v = Math.min(max, Math.max(min, Math.round(v)));
        this.#settings[key] = v;
        el.value = String(v);
      });
    };

    applyNumber(interval, "masterIntervalMs", 500, 60000);
    applyNumber(energy, "energyMinPct", 1, 99);
    applyNumber(send, "sendPct", 1, 99);
    applyNumber(moveCd, "moveCooldownMs", 5000, 3600000);
    applyNumber(testCd, "testCooldownMs", 5000, 3600000);
    applyNumber(silverMin, "silverMin", 1, 1e9);
    applyNumber(stale, "staleThresholdMs", 5000, 600000);

    enMove?.addEventListener("change", () => {
      this.#settings.enableMove = !!enMove.checked;
    });
    enReveal?.addEventListener("change", () => {
      this.#settings.enableReveal = !!enReveal.checked;
    });
    enPF?.addEventListener("change", () => {
      this.#settings.enableProspectFind = !!enPF.checked;
    });
    enW?.addEventListener("change", () => {
      this.#settings.enableWithdrawSilver = !!enW.checked;
    });

    sync();
  }

  #renderMetrics() {
    const q = (sel) => this.#root.querySelector(sel);
    const m = this.#metrics;
    const set = (attr, text) => {
      const el = q(`[${attr}]`);
      if (el) el.textContent = text;
    };

    set("data-m-fps", String(m.fps ?? "—"));
    set(
      "data-m-mem",
      m.heapUsedMb != null
        ? `${m.heapUsedMb} / ${m.heapLimitMb ?? "?"} MB`
        : "N/A"
    );
    set(
      "data-m-hash",
      m.hashRate != null ? String(Math.round(m.hashRate)) : "—"
    );
    set("data-m-mine", m.mining ? "yes" : "no");
    set(
      "data-m-queue",
      `${m.unconfirmedMoves ?? 0} (oldest ~${Math.round(m.unconfirmedOldestSec ?? 0)}s)`
    );
    set("data-m-skew", m.chainSkewMs != null ? `${m.chainSkewMs} ms` : "—");
    set("data-m-bal", m.balance ?? "—");
    set("data-m-planets", String(m.myPlanets ?? "—"));
    set("data-m-art", String(m.myArtifacts ?? "—"));
    set("data-m-players", String(m.players ?? "—"));
    set(
      "data-m-state",
      `${m.roundOver ? "ENDED " : ""}${m.paused ? "PAUSED" : "RUNNING"}`
    );
    set("data-m-acct", fmtAddr(m.account));
  }

  #renderHeartbeats() {
    const q = (sel) => this.#root.querySelector(sel);
    const now = Date.now();

    const apply = (attr, ts) => {
      const el = q(`[${attr}]`);
      if (!el) return;
      const { text, cls } = this.#heartbeatLabel(ts, now);
      el.textContent = text;
      el.className = cls;
    };

    apply("data-h-players", this.#hb.players);
    apply("data-h-planet", this.#hb.planet);
    apply("data-h-paused", this.#hb.paused);
    apply("data-h-sel", this.#hb.selected);

    const pv = q("[data-h-pause-val]");
    if (pv)
      pv.textContent =
        this.#hb.lastPausedValue === undefined
          ? "—"
          : String(!!this.#hb.lastPausedValue);
  }

  #renderTestRows() {
    const tbody = this.#root.querySelector("[data-th-tests-body]");
    if (!tbody) return;

    const now = Date.now();
    for (const row of Object.values(this.#tests)) {
      const tr = tbody.querySelector(`[data-test-id="${row.id}"]`);
      if (!tr) continue;

      const last = tr.querySelector("[data-col-last]");
      const runs = tr.querySelector("[data-col-runs]");
      const pass = tr.querySelector("[data-col-pass]");
      const fail = tr.querySelector("[data-col-fail]");
      const next = tr.querySelector("[data-col-next]");

      if (last) last.textContent = row.lastResult || "—";
      if (runs) runs.textContent = String(row.runs);
      if (pass) pass.textContent = String(row.passes);
      if (fail) fail.textContent = String(row.fails);

      let cd =
        row.id === "move"
          ? this.#settings.moveCooldownMs
          : this.#settings.testCooldownMs;
      const elapsed = now - row.lastRunAt;
      const remain = Math.max(0, cd - elapsed);
      if (next) next.textContent = row.lastRunAt ? fmtMs(remain) : "—";
    }
  }

  #renderLog() {
    const box = this.#root?.querySelector("[data-th-log]");
    if (!box) return;

    const colors = {
      info: "#a8a8a8",
      warn: "#f8b73e",
      error: "#FF6492",
      ok: "#00DC82",
    };

    box.innerHTML = "";
    const slice = this.#log.slice(-40);
    for (const e of slice) {
      const line = document.createElement("div");
      line.style.cssText = `font-size:11px;line-height:1.35;color:${colors[e.level] ?? colors.info};margin-bottom:2px;word-break:break-word;`;
      const t = new Date(e.ts).toISOString().slice(11, 23);
      line.textContent = `${t} ${e.msg}`;
      box.appendChild(line);
    }
    box.scrollTop = box.scrollHeight;
  }

  render(container) {
    Object.assign(container.style, {
      width: "440px",
      minHeight: "420px",
      maxHeight: "85vh",
      overflow: "auto",
      fontFamily: "sans-serif",
      color: "#e4e4e4",
    });

    this.#root = document.createElement("div");
    this.#root.innerHTML = `
      <style>
        .th-never { color: #FF6492; }
        .th-stale { color: #f8b73e; }
        .th-ok { color: #00DC82; }
        table.th-t { width:100%; border-collapse:collapse; font-size:12px; }
        table.th-t th, table.th-t td { padding:4px 6px; border-bottom:1px solid #444; text-align:left; }
        table.th-t td.num { text-align:right; }
        .th-h { font-size:11px; text-transform:uppercase; letter-spacing:0.06em; color:#888; margin:10px 0 6px; }
        .th-row { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-bottom:8px; }
        label.th { font-size:12px; color:#bbb; }
        input.th-in { width:52px; background:#2a2f36; color:#eee; border:1px solid #555; border-radius:3px; padding:3px 6px; }
        input.th-in-wide { width:72px; }
      </style>

      <div class="th-row">
        <label class="th"><input type="checkbox" data-th-master checked /> Master ON</label>
        <span style="color:#888;font-size:11px;">Account <span data-m-acct>—</span></span>
        <span style="color:#888;font-size:11px;">State <span data-m-state>—</span></span>
      </div>

      <div class="th-row">
        <label class="th">Tick ms <input class="th-in th-in-wide" type="number" data-th-interval value="${DEFAULT_MASTER_MS}" /></label>
        <label class="th">Energy min % <input class="th-in" type="number" data-th-energy value="75" /></label>
        <label class="th">Send % <input class="th-in" type="number" data-th-send value="10" /></label>
      </div>
      <div class="th-row">
        <label class="th">Move CD ms <input class="th-in th-in-wide" type="number" data-th-move-cd value="${DEFAULT_MOVE_COOLDOWN_MS}" /></label>
        <label class="th">Test CD ms <input class="th-in th-in-wide" type="number" data-th-test-cd value="${DEFAULT_TEST_COOLDOWN_MS}" /></label>
        <label class="th">Silver min <input class="th-in" type="number" data-th-silver value="10" /></label>
        <label class="th">Stale ms <input class="th-in th-in-wide" type="number" data-th-stale value="${EVENT_STALE_MS}" /></label>
      </div>

      <div class="th-row">
        <label class="th"><input type="checkbox" data-th-en-move checked /> Move</label>
        <label class="th"><input type="checkbox" data-th-en-reveal checked /> Reveal</label>
        <label class="th"><input type="checkbox" data-th-en-pf checked /> Prospect/Find</label>
        <label class="th"><input type="checkbox" data-th-en-wd checked /> Withdraw Ag</label>
      </div>
      <div style="font-size:11px;color:#888;margin-bottom:8px;">
        Moves are own-planet transfers only (no attacking). All txs require wallet confirmation when applicable.
      </div>

      <div class="th-h">Runtime</div>
      <table class="th-t">
        <tbody>
          <tr><td>FPS</td><td class="num" data-m-fps>—</td></tr>
          <tr><td>Heap</td><td class="num" data-m-mem>—</td></tr>
          <tr><td>Hash rate</td><td class="num" data-m-hash>—</td></tr>
          <tr><td>Mining</td><td class="num" data-m-mine>—</td></tr>
          <tr><td>Unconfirmed moves</td><td class="num" data-m-queue>—</td></tr>
          <tr><td>Chain skew</td><td class="num" data-m-skew>—</td></tr>
          <tr><td>Balance (wei)</td><td class="num" data-m-bal>—</td></tr>
          <tr><td>My planets / artifacts</td><td class="num"><span data-m-planets>—</span> / <span data-m-art>—</span></td></tr>
          <tr><td>Players</td><td class="num" data-m-players>—</td></tr>
        </tbody>
      </table>

      <div class="th-h">Event streams</div>
      <table class="th-t">
        <tbody>
          <tr><td>playersUpdated$</td><td class="num" data-h-players>—</td></tr>
          <tr><td>planetUpdated$</td><td class="num" data-h-planet>—</td></tr>
          <tr><td>getPaused$</td><td class="num" data-h-paused>—</td><td data-h-pause-val style="font-size:11px;color:#888;">—</td></tr>
          <tr><td>selectedPlanetId$</td><td class="num" data-h-sel>—</td></tr>
        </tbody>
      </table>

      <div class="th-h">Tests</div>
      <table class="th-t">
        <thead>
          <tr><th>Test</th><th>Last</th><th class="num">Runs</th><th class="num">OK</th><th class="num">Fail</th><th class="num">CD left</th></tr>
        </thead>
        <tbody data-th-tests-body>
          <tr data-test-id="move"><td>Move</td><td data-col-last style="max-width:140px;overflow:hidden;text-overflow:ellipsis;">—</td><td class="num" data-col-runs>0</td><td class="num" data-col-pass>0</td><td class="num" data-col-fail>0</td><td class="num" data-col-next>—</td></tr>
          <tr data-test-id="reveal"><td>Reveal</td><td data-col-last style="max-width:140px;">—</td><td class="num" data-col-runs>0</td><td class="num" data-col-pass>0</td><td class="num" data-col-fail>0</td><td class="num" data-col-next>—</td></tr>
          <tr data-test-id="prospectFind"><td>Prospect/Find</td><td data-col-last style="max-width:140px;">—</td><td class="num" data-col-runs>0</td><td class="num" data-col-pass>0</td><td class="num" data-col-fail>0</td><td class="num" data-col-next>—</td></tr>
          <tr data-test-id="withdrawSilver"><td>Withdraw Ag</td><td data-col-last style="max-width:140px;">—</td><td class="num" data-col-runs>0</td><td class="num" data-col-pass>0</td><td class="num" data-col-fail>0</td><td class="num" data-col-next>—</td></tr>
        </tbody>
      </table>

      <div class="th-h">Log (last ${LOG_MAX})</div>
      <div data-th-log style="max-height:160px;overflow:auto;background:#1a1d22;border:1px solid #444;border-radius:4px;padding:6px;"></div>
    `;

    container.appendChild(this.#root);

    this.#bindControls();
    this.#startRaf();

    // subscriptions
    this.#subscribe(df.playersUpdated$, "players");
    const go = df.getGameObjects?.();
    if (go?.planetUpdated$) this.#subscribe(go.planetUpdated$, "planet");
    this.#subscribe(df.getPaused$?.(), "paused");
    this.#subscribe(ui.selectedPlanetId$, "selected");

    this.log("info", "Test Harness started");

    const schedule = () => {
      if (this.#destroyed) return;
      void this.#tick();
    };

    this.#intervalId = window.setInterval(
      schedule,
      this.#settings.masterIntervalMs
    );
    // Re-interval when user changes interval — simpler: restart on change
    const intervalEl = this.#root.querySelector("[data-th-interval]");
    intervalEl?.addEventListener("change", () => {
      const v = Math.min(
        60000,
        Math.max(500, Number(intervalEl.value) || 2000)
      );
      this.#settings.masterIntervalMs = v;
      if (this.#intervalId) clearInterval(this.#intervalId);
      this.#intervalId = window.setInterval(schedule, v);
      this.log("info", `tick interval ${v}ms`);
    });

    schedule();
  }

  destroy() {
    this.#destroyed = true;
    if (this.#intervalId) {
      clearInterval(this.#intervalId);
      this.#intervalId = null;
    }
    if (this.#rafId) {
      cancelAnimationFrame(this.#rafId);
      this.#rafId = null;
    }
    for (const sub of this.#subs) {
      try {
        sub.unsubscribe?.();
      } catch {
        /* ignore */
      }
    }
    this.#subs = [];
    if (this.#root?.parentNode) this.#root.remove();
    this.#root = null;
  }
}
