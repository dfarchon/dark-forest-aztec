/**
 * Score-board — Leaderboard with countdown timer and refresh.
 * Embedded plugin for dfpunk-aztec. Uses only globals df + ui.
 */

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sort_players(m) {
  const a = Array.from(m);
  const sortPart = a.filter((t) => t[1] !== undefined);
  const notSortPart = a.filter((t) => t[1] === undefined);
  sortPart.sort((x, y) => y[1] - x[1]);
  return [...sortPart, ...notSortPart];
}

function create_head() {
  const row = document.createElement("tr");
  row.style.width = "100%";
  row.style.height = "26px";
  for (let i = 0; i < 3; i++) {
    row.appendChild(document.createElement("th"));
  }
  row.children[0].innerHTML = "place";
  row.children[1].innerHTML = "player";
  row.children[2].innerHTML = "score";
  row.children[0].style.width = "40px";
  row.children[1].style.width = "146px";
  row.children[2].style.width = "80px";
  return row;
}

function create_row() {
  const row = document.createElement("tr");
  row.style.width = "100%";
  row.style.height = "26px";
  const rank = document.createElement("td");
  rank.style.textAlign = "right";
  row.appendChild(rank);
  const user = document.createElement("td");
  user.style.maxWidth = "146px";
  user.style.overflow = "hidden";
  row.appendChild(user);
  const score = document.createElement("td");
  score.style.textAlign = "right";
  row.appendChild(score);
  return row;
}

function timestampSection(value) {
  return value.toString().padStart(2, "0");
}

const btnStyle = {
  background: "#3d444c",
  color: "#e4e4e4",
  border: "1px solid #5a6268",
  borderRadius: "4px",
  padding: "6px 12px",
  cursor: "pointer",
  fontSize: "13px",
};

function rowColor(rank) {
  if (rank === 1) return "#ff44b7";
  if (rank <= 3) return "#f8b73e";
  if (rank <= 7) return "#c13cff";
  if (rank <= 15) return "#6b68ff";
  if (rank <= 31) return "green";
  if (rank <= 63) return "white";
  return "#e4e4e4";
}

class Plugin {
  constructor() {
    this.end_time = new Date("2025-10-31T13:00:00Z");
    this.timer = document.createElement("div");
    this.timer.style.width = "100%";
    this.timer.style.textAlign = "center";

    this.table = document.createElement("table");
    this.table.style.maxHeight = "300px";
    this.table.style.display = "block";
    this.table.style.borderSpacing = "8px 0";
    this.table.style.borderCollapse = "separate";
    this.table.style.overflow = "scroll";

    this.table.appendChild(create_head());
    const n = (df.getAllPlayers?.() ?? []).length;
    for (let i = 0; i < n; i++) {
      this.table.appendChild(create_row());
    }
    this.n = n;
    this.scoreboard = new Map();

    this.refresh_button = document.createElement("button");
    this.refresh_button.style.width = "100%";
    this.refresh_button.style.height = "26px";
    Object.assign(this.refresh_button.style, btnStyle);
    this.refresh_button.innerText = "refresh";
    this.refresh_button.onclick = () => this.update_players();

    this.interval_handle = window.setInterval(() => this.update_timer(), 1000);
    this.refresh_interval_handle = window.setInterval(
      () => this.update_players(),
      10_000
    );
    this.update_timer();
    this.update_players();
  }

  update_timer = () => {
    if (!this.timer) return;
    const now = new Date();
    let t = Math.floor((this.end_time - now) / 1000);
    if (t < 0) t = 0;
    const h = Math.floor(t / 3600);
    const m = Math.floor((t - h * 3600) / 60);
    const s = t - h * 3600 - m * 60;
    this.timer.innerText =
      timestampSection(h) +
      ":" +
      timestampSection(m) +
      ":" +
      timestampSection(s);
  };

  update_table = () => {
    if (!this.table) return;
    const players = sort_players(this.scoreboard);

    for (let i = this.n; i < players.length; i++) {
      this.table.appendChild(create_row());
    }
    this.n = players.length;

    const getPlayer = (addr) =>
      typeof df.getPlayer === "function" ? df.getPlayer(addr) : undefined;

    for (let i = 0; i < players.length; i++) {
      const rowEl = this.table.children[i + 1];
      if (!rowEl) continue;

      const rank = i + 1;
      rowEl.children[0].innerHTML = `${rank}.`;
      rowEl.children[2].innerHTML =
        players[i][1] === undefined ? "n/a" : String(players[i][1]);

      const address = players[i][0];
      const p_data = getPlayer(address);
      let name = address;
      if (p_data?.twitter) {
        name = `<a href="https://twitter.com/${p_data.twitter}" target="_blank" rel="noopener">@${p_data.twitter}</a>`;
      }
      rowEl.children[1].innerHTML = name;
      rowEl.style.color = rowColor(rank);
    }

    for (let i = players.length + 1; i < this.table.children.length; i++) {
      const rowEl = this.table.children[i];
      if (rowEl) rowEl.style.color = "#e4e4e4";
    }
  };

  update_score = (players) => {
    if (!this.table) return;
    const getScore = (addr) =>
      typeof df.getPlayerScore === "function"
        ? df.getPlayerScore(addr)
        : undefined;

    for (const player of players) {
      const address = (player.address || player).toString().toLowerCase();
      const raw = getScore(address);
      const score = raw != null ? Number(raw) : undefined;
      this.scoreboard.set(address, score);
    }
    this.update_table();
  };

  update_players = async () => {
    if (!this.refresh_button) return;
    this.refresh_button.innerText = "refreshing...";
    this.refresh_button.disabled = true;

    const players = Array.from(df.getAllPlayers?.() ?? []);
    await sleep(300);
    this.update_score(players);

    this.refresh_button.innerText = "refresh";
    this.refresh_button.disabled = false;
  };

  async render(container) {
    container.style.width = "300px";
    container.appendChild(this.timer);
    container.appendChild(this.table);
    container.appendChild(this.refresh_button);
  }

  destroy() {
    if (this.interval_handle) {
      window.clearInterval(this.interval_handle);
      this.interval_handle = null;
    }
    if (this.refresh_interval_handle) {
      window.clearInterval(this.refresh_interval_handle);
      this.refresh_interval_handle = null;
    }
    this.timer = null;
    this.table = null;
    this.refresh_button = null;
    this.scoreboard = null;
  }
}

export default Plugin;
