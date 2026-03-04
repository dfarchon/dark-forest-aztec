/**
 * Voyage Time — View estimated move time and energy for a voyage.
 * Embedded plugin for dfpunk-aztec. Uses only globals df + ui.
 */

const secondsPerMinute = 60;
const secondsPerHour = 3600;

function debounce(fn, timeout) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), timeout);
  };
}

function formatEstimatedTime({ hours, minutes, seconds }) {
  if (hours >= 1) return `${hours} hrs, ${minutes} mins, ${seconds} secs`;
  if (minutes >= 1) return `${minutes} mins, ${seconds} secs`;
  return `${seconds} secs`;
}

function formatEnergy(value) {
  if (value > 1_000_000) return (value / 1_000_000).toFixed(1) + "M";
  if (value > 1000) return (value / 1000).toFixed(1) + "K";
  return String(value);
}

function computeVoyageTime(planetFrom, planetTo) {
  if (typeof df.getTimeForMove !== "function") return null;
  const time = parseInt(
    Math.ceil(df.getTimeForMove(planetFrom.locationId, planetTo.locationId)),
    10
  );
  return {
    time,
    hours: Math.floor(time / secondsPerHour),
    minutes: Math.floor((time % secondsPerHour) / secondsPerMinute),
    seconds: (time % secondsPerHour) % secondsPerMinute,
  };
}

function computeVoyageEnergy(planetFrom, planetTo, energyPercent) {
  if (typeof df.getEnergyArrivingForMove !== "function") return null;
  const energySent = (planetFrom.energyCap * energyPercent) / 100;
  let energyArriving = df.getEnergyArrivingForMove(
    planetFrom.locationId,
    planetTo.locationId,
    undefined,
    energySent,
    false
  );
  const account =
    typeof df.getAccount === "function" ? df.getAccount() : undefined;
  if (
    planetTo.owner !== account &&
    planetTo.defense != null &&
    planetTo.defense > 0
  ) {
    energyArriving = (energyArriving * 100) / planetTo.defense;
  }
  return {
    sent: Math.ceil(energySent),
    arriving: Math.ceil(energyArriving),
  };
}

class Plugin {
  #energyPercent = 55;
  #root = document.createElement("div");
  #debouncedUpdate = debounce(() => this.update(), 30);

  update() {
    const planetFrom = ui.getSelectedPlanet?.();
    const planetTo = ui.getHoveringOverPlanet?.();

    const shouldCompute =
      planetFrom && planetTo && planetFrom.locationId !== planetTo.locationId;

    const computedVoyageTime = shouldCompute
      ? computeVoyageTime(planetFrom, planetTo)
      : undefined;
    const computedVoyageEnergy = shouldCompute
      ? computeVoyageEnergy(planetFrom, planetTo, this.#energyPercent)
      : undefined;

    const timeEl = this.#root.querySelector("[data-time]");
    const estimatedEl = this.#root.querySelector("[data-estimated-time]");
    const sentEl = this.#root.querySelector("[data-energy-sent]");
    const arrivingEl = this.#root.querySelector("[data-energy-arriving]");

    if (timeEl)
      timeEl.textContent = computedVoyageTime?.time
        ? `${computedVoyageTime.time} secs`
        : "n/a";
    if (estimatedEl)
      estimatedEl.textContent = computedVoyageTime
        ? formatEstimatedTime(computedVoyageTime)
        : "n/a";
    if (sentEl)
      sentEl.textContent = computedVoyageEnergy?.sent
        ? formatEnergy(computedVoyageEnergy.sent)
        : "n/a";
    if (arrivingEl)
      arrivingEl.textContent = computedVoyageEnergy?.arriving
        ? formatEnergy(computedVoyageEnergy.arriving)
        : "n/a";
  }

  render(container) {
    this.#root.className = "voyage-time";
    this.#root.innerHTML = `
      <style>
        .voyage-time { display: block; }
        .voyage-time h4 { font-size: 1.2em; text-decoration: underline; }
        .voyage-time [data-table] {
          display: grid;
          grid-template-columns: 100px auto;
          margin-bottom: 8px;
        }
        .voyage-time [data-table] p:nth-child(odd) { color: rgb(131, 131, 131); }
        .voyage-time [data-table] p:nth-child(even) { font-size: 10pt; }
        .voyage-time [data-slider] {
          display: flex;
          flex-direction: row;
          justify-content: space-between;
          margin-bottom: 8px;
        }
        .voyage-time [data-slider] p { height: 24px; }
        .voyage-time [data-slider] p:nth-child(odd) { width: 200px; }
        .voyage-time [data-slider] p:nth-child(odd) input { width: 100%; }
        .voyage-time [data-slider] p:nth-child(even) { font-size: 10pt; width: 80px; }
      </style>
      <h4>Time for move</h4>
      <div data-table>
        <p>Total:</p>
        <p><code data-time>n/a</code></p>
        <p>Estimated:</p>
        <p><code data-estimated-time>n/a</code></p>
      </div>
      <h4>Energy for move</h4>
      <div data-slider>
        <p><input type="range" min="0" max="100" step="5" value="${this.#energyPercent}" /></p>
        <p><code data-percent>${this.#energyPercent}%</code></p>
      </div>
      <div data-table>
        <p>Sending:</p>
        <p><code data-energy-sent>n/a</code></p>
        <p>Arriving:</p>
        <p><code data-energy-arriving>n/a</code></p>
      </div>
    `;

    const sliderInput = this.#root.querySelector("[data-slider] input");
    const percentEl = this.#root.querySelector("[data-percent]");
    if (sliderInput && percentEl) {
      sliderInput.addEventListener("input", (e) => {
        const value = Number(e.target.value);
        this.#energyPercent = value;
        percentEl.textContent = `${value}%`;
        this.update();
      });
    }

    if (container.parentElement)
      container.parentElement.style.minHeight = "unset";
    container.style.width = "300px";
    container.style.minHeight = "unset";
    container.appendChild(this.#root);

    this.update();
    window.addEventListener("mousemove", this.#debouncedUpdate);
  }

  destroy() {
    window.removeEventListener("mousemove", this.#debouncedUpdate);
    this.#root.remove?.();
  }
}

export default Plugin;
