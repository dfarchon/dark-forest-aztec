/**
 * Diplomacy Ambassador — Color map by diplomacy: Friendly / Neutral / Enemy.
 * Select a planet, then add its owner to Friendly, Neutral, or Enemy. Heatmap or planet circles.
 * By 9STX6. Embedded plugin for dfpunk-aztec. Uses only globals df + ui.
 */

const btnStyle = {
  background: "#3d444c",
  color: "#e4e4e4",
  border: "1px solid #5a6268",
  borderRadius: "4px",
  padding: "6px 10px",
  cursor: "pointer",
  fontSize: "13px",
  marginBottom: "8px",
};

class Plugin {
  constructor() {
    this.playersFriendly = [];
    this.playersNeutral = [];
    this.playersEnemy = [];
    this.highlightStyle = 0;
    this.rangePercent = 8;
    this.alpha = 0.01;
    this.globalAlpha = 0.5;
    this.ownColor = "#ffffff";
    this.FriendlyColor = "#00FF00";
    this.NeutralColor = "#FFFF00";
    this.EnemyColor = "#FF0000";
    this.statusEl = null;
    this.timerId = null;

    this.highlightStyleHandler = this.highlightStyleHandler.bind(this);
    this.rangeHandler = this.rangeHandler.bind(this);
    this.alphaHandler = this.alphaHandler.bind(this);
    this.globalAlphaHandler = this.globalAlphaHandler.bind(this);
    this.ownColorHandler = this.ownColorHandler.bind(this);
    this.FriendlyColorHandler = this.FriendlyColorHandler.bind(this);
    this.NeutralColorHandler = this.NeutralColorHandler.bind(this);
    this.EnemyColorHandler = this.EnemyColorHandler.bind(this);

    this.updatePlanetData();
    this.timerId = setInterval(() => this.updatePlanetData(), 30000);
  }

  status(msg) {
    if (this.statusEl) this.statusEl.textContent = msg || "";
  }

  removeAllChildNodes(parent) {
    while (parent.firstChild) parent.removeChild(parent.firstChild);
  }

  hexToHsl(H) {
    let r = 0,
      g = 0,
      b = 0;
    if (H.length === 4) {
      r = "0x" + H[1] + H[1];
      g = "0x" + H[2] + H[2];
      b = "0x" + H[3] + H[3];
    } else if (H.length === 7) {
      r = "0x" + H[1] + H[2];
      g = "0x" + H[3] + H[4];
      b = "0x" + H[5] + H[6];
    }
    r /= 255;
    g /= 255;
    b /= 255;
    const cmin = Math.min(r, g, b);
    const cmax = Math.max(r, g, b);
    const delta = cmax - cmin;
    let h = 0,
      s = 0,
      l = 0;
    if (delta === 0) h = 0;
    else if (cmax === r) h = ((g - b) / delta) % 6;
    else if (cmax === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h = Math.round(h * 60);
    if (h < 0) h += 360;
    l = (cmax + cmin) / 2;
    s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
    s = +(s * 100).toFixed(1);
    l = +(l * 100).toFixed(1);
    return [h + ", " + s + "%, " + l + "%"];
  }

  getSliderHtml(className, text, min, max, step, value) {
    return `<label class='${className}'>
      <div style='display: inline-block; min-width: 120px'>${text}</div>
      <input type='range' value='${value}' min='${min}' max='${max}' step='${step}' style='transform: translateY(3px); margin: 0 10px;' />
      <span>${value}</span>
    </label>`;
  }

  getColorPicker(className, text, value) {
    return `<label class='${className}'>
      <div style='display: inline-block; min-width: 120px'>${text}</div>
      <input type='color' value='${value}' style='transform: translateY(3px); margin: 0 10px;' />
    </label>`;
  }

  getSelect(className, text, items, selectedValue) {
    const opts = items
      .map(
        ({ value, text: t }) =>
          `<option value=${value}${Number(selectedValue) === value ? " selected" : ""}>${t}</option>`
      )
      .join("");
    return `<label class='${className}'>
      <div style='display: inline-block; min-width: 120px'>${text}</div>
      <select style='background: rgb(8,8,8); margin-top: 5px; padding: 3px 5px; border: 1px solid #5a6268; border-radius: 3px; color: #e4e4e4;' value=${selectedValue}>${opts}</select>
    </label>`;
  }

  updatePlanetData() {
    this.planetsOwner =
      (typeof df.getMyPlanets === "function" ? df.getMyPlanets() : []) || [];
    const allOwned =
      (typeof df.getAllOwnedPlanets === "function"
        ? df.getAllOwnedPlanets()
        : []) || [];
    this.planetsFriendly = allOwned.filter((p) =>
      this.playersFriendly.includes(p.owner)
    );
    this.planetsNeutral = allOwned.filter((p) =>
      this.playersNeutral.includes(p.owner)
    );
    this.planetsEnemy = allOwned.filter((p) =>
      this.playersEnemy.includes(p.owner)
    );
  }

  renderSourceList(container, list, listRef, label, renderAll) {
    this.removeAllChildNodes(container);
    if (!list.length) {
      container.innerText = `Current ${label}: none`;
      return;
    }
    container.appendChild(document.createTextNode(`Current ${label}: `));
    for (const item of list) {
      container.appendChild(
        document.createTextNode(String(item).substr(0, 20))
      );
      const delBtn = document.createElement("button");
      delBtn.innerText = "Del";
      Object.assign(delBtn.style, btnStyle, {
        width: "auto",
        marginLeft: "10px",
        display: "inline-block",
      });
      delBtn.addEventListener("click", () => {
        const idx = listRef.indexOf(item);
        if (idx !== -1) {
          listRef.splice(idx, 1);
          this.updatePlanetData();
          renderAll();
        }
      });
      container.appendChild(delBtn);
      container.appendChild(document.createElement("br"));
    }
  }

  render(container) {
    container.style.width = "450px";

    this.statusEl = document.createElement("div");
    this.statusEl.style.minHeight = "20px";
    this.statusEl.style.marginBottom = "8px";
    this.statusEl.style.color = "#c13cff";

    const sourceContainerFriendly = document.createElement("div");
    sourceContainerFriendly.innerText = "Current Friendly: none";
    const sourceContainerNeutral = document.createElement("div");
    sourceContainerNeutral.innerText = "Current Neutral: none";
    const sourceContainerEnemy = document.createElement("div");
    sourceContainerEnemy.innerText = "Current Enemy: none";

    const renderAll = () => {
      this.renderSourceList(
        sourceContainerFriendly,
        this.playersFriendly,
        this.playersFriendly,
        "Friendly",
        renderAll
      );
      this.renderSourceList(
        sourceContainerNeutral,
        this.playersNeutral,
        this.playersNeutral,
        "Neutral",
        renderAll
      );
      this.renderSourceList(
        sourceContainerEnemy,
        this.playersEnemy,
        this.playersEnemy,
        "Enemy",
        renderAll
      );
    };

    const sourceColorOwner = document.createElement("div");
    sourceColorOwner.style.width = "100%";
    sourceColorOwner.innerHTML = [
      this.getColorPicker("ownColor", "Your Color:", this.ownColor),
      this.getSelect(
        "highlight",
        "Highlight:",
        [{ value: 0, text: "Heatmap" }],
        this.highlightStyle
      ),
      this.getSliderHtml(
        "range",
        "Planet Range:",
        1,
        100,
        1,
        this.rangePercent
      ),
      this.getSliderHtml("alpha", "Gradient Alpha:", 0, 1, 0.01, this.alpha),
      this.getSliderHtml(
        "globalAlpha",
        "Global Alpha:",
        0,
        1,
        0.01,
        this.globalAlpha
      ),
    ].join("<br />");

    this.selectHighlightStyle = sourceColorOwner.querySelector(
      "label.highlight select"
    );
    if (this.selectHighlightStyle)
      this.selectHighlightStyle.addEventListener(
        "change",
        this.highlightStyleHandler
      );

    this.valueRange = sourceColorOwner.querySelector("label.range span");
    this.sliderRange = sourceColorOwner.querySelector("label.range input");
    if (this.sliderRange)
      this.sliderRange.addEventListener("input", this.rangeHandler);

    this.valueAlpha = sourceColorOwner.querySelector("label.alpha span");
    this.sliderAlpha = sourceColorOwner.querySelector("label.alpha input");
    if (this.sliderAlpha)
      this.sliderAlpha.addEventListener("input", this.alphaHandler);

    this.valueGlobalAlpha = sourceColorOwner.querySelector(
      "label.globalAlpha span"
    );
    this.sliderGlobalAlpha = sourceColorOwner.querySelector(
      "label.globalAlpha input"
    );
    if (this.sliderGlobalAlpha)
      this.sliderGlobalAlpha.addEventListener("input", this.globalAlphaHandler);

    this.colorPickerOwnColor = sourceColorOwner.querySelector(
      "label.ownColor input"
    );
    if (this.colorPickerOwnColor)
      this.colorPickerOwnColor.addEventListener("input", this.ownColorHandler);

    const sourceColorFriendly = document.createElement("div");
    sourceColorFriendly.style.width = "100%";
    sourceColorFriendly.innerHTML = this.getColorPicker(
      "FriendlyColor",
      "Friendly Color:",
      this.FriendlyColor
    );
    this.colorPickerFriendlyColor = sourceColorFriendly.querySelector(
      "label.FriendlyColor input"
    );
    if (this.colorPickerFriendlyColor)
      this.colorPickerFriendlyColor.addEventListener(
        "input",
        this.FriendlyColorHandler
      );

    const sourceColorNeutral = document.createElement("div");
    sourceColorNeutral.style.width = "100%";
    sourceColorNeutral.innerHTML = this.getColorPicker(
      "NeutralColor",
      "Neutral Color:",
      this.NeutralColor
    );
    this.colorPickerNeutralColor = sourceColorNeutral.querySelector(
      "label.NeutralColor input"
    );
    if (this.colorPickerNeutralColor)
      this.colorPickerNeutralColor.addEventListener(
        "input",
        this.NeutralColorHandler
      );

    const sourceColorEnemy = document.createElement("div");
    sourceColorEnemy.style.width = "100%";
    sourceColorEnemy.innerHTML = this.getColorPicker(
      "EnemyColor",
      "Enemy Color:",
      this.EnemyColor
    );
    this.colorPickerEnemyColor = sourceColorEnemy.querySelector(
      "label.EnemyColor input"
    );
    if (this.colorPickerEnemyColor)
      this.colorPickerEnemyColor.addEventListener(
        "input",
        this.EnemyColorHandler
      );

    const add = (list, other1, other2, label) => () => {
      const selected = ui.getSelectedPlanet?.();
      if (!selected) {
        this.status("Select a planet first.");
        return;
      }
      const owner = selected.owner;
      if (list.includes(owner)) {
        this.status(`Already in ${label}.`);
        return;
      }
      other1.splice(0, other1.length, ...other1.filter((e) => e !== owner));
      other2.splice(0, other2.length, ...other2.filter((e) => e !== owner));
      list.push(owner);
      this.updatePlanetData();
      renderAll();
      this.status(`Added to ${label}.`);
    };

    const addButtonFriendly = document.createElement("button");
    Object.assign(addButtonFriendly.style, btnStyle, { width: "45%" });
    addButtonFriendly.innerHTML = "Add Friendly";
    addButtonFriendly.onclick = add(
      this.playersFriendly,
      this.playersNeutral,
      this.playersEnemy,
      "Friendly"
    );

    const addButtonNeutral = document.createElement("button");
    Object.assign(addButtonNeutral.style, btnStyle, { width: "45%" });
    addButtonNeutral.innerHTML = "Add Neutral";
    addButtonNeutral.onclick = add(
      this.playersNeutral,
      this.playersFriendly,
      this.playersEnemy,
      "Neutral"
    );

    const addButtonEnemy = document.createElement("button");
    Object.assign(addButtonEnemy.style, btnStyle, { width: "45%" });
    addButtonEnemy.innerHTML = "Add Enemy";
    addButtonEnemy.onclick = add(
      this.playersEnemy,
      this.playersFriendly,
      this.playersNeutral,
      "Enemy"
    );

    const clear = (list, container, label) => () => {
      list.length = 0;
      this.updatePlanetData();
      container.innerText = `Current ${label}: none`;
      renderAll();
    };

    const clearButtonFriendly = document.createElement("button");
    Object.assign(clearButtonFriendly.style, btnStyle, { width: "45%" });
    clearButtonFriendly.innerHTML = "Clean Friendly";
    clearButtonFriendly.onclick = clear(
      this.playersFriendly,
      sourceContainerFriendly,
      "Friendly"
    );

    const clearButtonNeutral = document.createElement("button");
    Object.assign(clearButtonNeutral.style, btnStyle, { width: "45%" });
    clearButtonNeutral.innerHTML = "Clean Neutral";
    clearButtonNeutral.onclick = clear(
      this.playersNeutral,
      sourceContainerNeutral,
      "Neutral"
    );

    const clearButtonEnemy = document.createElement("button");
    Object.assign(clearButtonEnemy.style, btnStyle, { width: "45%" });
    clearButtonEnemy.innerHTML = "Clean Enemy";
    clearButtonEnemy.onclick = clear(
      this.playersEnemy,
      sourceContainerEnemy,
      "Enemy"
    );

    const LoadButton = document.createElement("button");
    Object.assign(LoadButton.style, btnStyle, { width: "45%" });
    LoadButton.innerHTML = "Load Diplomacy";
    LoadButton.onclick = () => {
      const inputFile = document.createElement("input");
      inputFile.type = "file";
      inputFile.onchange = () => {
        const file = inputFile.files?.item(0);
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const obj = JSON.parse(reader.result);
            this.playersFriendly = obj.playersFriendly || [];
            this.playersNeutral = obj.playersNeutral || [];
            this.playersEnemy = obj.playersEnemy || [];
            this.updatePlanetData();
            renderAll();
            this.status("Loaded.");
          } catch (e) {
            this.status("Invalid file.");
          }
        };
        reader.readAsText(file);
      };
      inputFile.click();
    };

    const SaveButton = document.createElement("button");
    Object.assign(SaveButton.style, btnStyle, { width: "45%" });
    SaveButton.innerHTML = "Save Diplomacy";
    SaveButton.onclick = () => {
      const save = JSON.stringify({
        playersFriendly: this.playersFriendly,
        playersNeutral: this.playersNeutral,
        playersEnemy: this.playersEnemy,
      });
      const blob = new Blob([save], { type: "application/json" });
      const anchor = document.createElement("a");
      const account =
        typeof df.getAccount === "function"
          ? String(df.getAccount()).slice(0, 8)
          : "diplomacy";
      anchor.download =
        new Date().toISOString().slice(0, 10) +
        "_" +
        account +
        "_DiplomacyAmbassador.json";
      anchor.href = (window.URL || window.webkitURL).createObjectURL(blob);
      anchor.click();
      if (anchor.href) URL.revokeObjectURL(anchor.href);
      this.status("Saved.");
    };

    container.appendChild(this.statusEl);
    container.appendChild(sourceColorOwner);
    container.appendChild(addButtonFriendly);
    container.appendChild(clearButtonFriendly);
    container.appendChild(sourceColorFriendly);
    container.appendChild(sourceContainerFriendly);
    container.appendChild(addButtonNeutral);
    container.appendChild(clearButtonNeutral);
    container.appendChild(sourceColorNeutral);
    container.appendChild(sourceContainerNeutral);
    container.appendChild(addButtonEnemy);
    container.appendChild(clearButtonEnemy);
    container.appendChild(sourceColorEnemy);
    container.appendChild(sourceContainerEnemy);
    container.appendChild(LoadButton);
    container.appendChild(SaveButton);
  }

  highlightStyleHandler() {
    if (this.selectHighlightStyle)
      this.highlightStyle = Number(this.selectHighlightStyle.value);
    const alphaLabel = document.querySelector("label.alpha");
    const rangeLabel = document.querySelector("label.range");
    const globalLabel = document.querySelector("label.globalAlpha");
    const show = this.highlightStyle === 0;
    if (alphaLabel) alphaLabel.style.display = show ? "inline-block" : "none";
    if (rangeLabel) rangeLabel.style.display = show ? "inline-block" : "none";
    if (globalLabel) globalLabel.style.display = show ? "inline-block" : "none";
  }

  rangeHandler() {
    if (this.sliderRange) {
      this.rangePercent = parseInt(this.sliderRange.value, 10);
      if (this.valueRange)
        this.valueRange.innerHTML = this.sliderRange.value + "%";
    }
  }

  alphaHandler() {
    if (this.sliderAlpha) {
      this.alpha = parseFloat(this.sliderAlpha.value);
      if (this.valueAlpha) this.valueAlpha.innerHTML = this.sliderAlpha.value;
    }
  }

  globalAlphaHandler() {
    if (this.sliderGlobalAlpha) {
      this.globalAlpha = parseFloat(this.sliderGlobalAlpha.value);
      if (this.valueGlobalAlpha)
        this.valueGlobalAlpha.innerHTML = this.sliderGlobalAlpha.value;
    }
  }

  ownColorHandler() {
    if (this.colorPickerOwnColor)
      this.ownColor = this.colorPickerOwnColor.value;
  }

  FriendlyColorHandler() {
    if (this.colorPickerFriendlyColor)
      this.FriendlyColor = this.colorPickerFriendlyColor.value;
  }

  NeutralColorHandler() {
    if (this.colorPickerNeutralColor)
      this.NeutralColor = this.colorPickerNeutralColor.value;
  }

  EnemyColorHandler() {
    if (this.colorPickerEnemyColor)
      this.EnemyColor = this.colorPickerEnemyColor.value;
  }

  draw(ctx) {
    const viewport = ui.getViewport?.();
    if (!viewport) return;

    const worldToCanvasCoords = (coords) =>
      viewport.worldToCanvasCoords(coords);
    const worldToCanvasDist = (d) => viewport.worldToCanvasDist(d);
    const getRadius = (level) =>
      (typeof ui.getRadiusOfPlanetLevel === "function"
        ? ui.getRadiusOfPlanetLevel(level)
        : 10) || 10;

    const origGlobalAlpha = ctx.globalAlpha;
    const origFillStyle = ctx.fillStyle;
    const origStrokeStyle = ctx.strokeStyle;

    const fac = Math.max(0, Math.log2(this.rangePercent / 5));
    const drawRangeCircle = (ctx, x, y, trueRange, hsl) => {
      ctx.beginPath();
      ctx.arc(x, y, trueRange, 0, 2 * Math.PI);
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, trueRange);
      gradient.addColorStop(0, `hsla(${hsl}, 1)`);
      gradient.addColorStop(1, `hsla(${hsl}, ${this.alpha})`);
      ctx.fillStyle = gradient;
      ctx.fill();
    };

    const drawPlanet = (ctx, coords, planetLevel, color, isDashed = false) => {
      const c = worldToCanvasCoords(coords);
      const r = worldToCanvasDist(getRadius(planetLevel));
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      if (isDashed) ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, 2 * Math.PI);
      ctx.fill();
      ctx.closePath();
      if (isDashed) ctx.setLineDash([]);
    };

    const renderPlanets = (ctx, planets, color, highlightStyle) => {
      if (!planets?.length) return;
      const hsl = this.hexToHsl(color);

      for (const p of planets) {
        if (!p?.location?.coords) continue;
        const { x, y } = worldToCanvasCoords(p.location.coords);
        const range = fac * (p.range ?? 0);
        const trueRange = worldToCanvasDist(range);

        if (highlightStyle === 0 && this.alpha && trueRange > 0) {
          drawRangeCircle(ctx, x, y, trueRange, hsl);
        } else {
          drawPlanet(
            ctx,
            p.location.coords,
            p.planetLevel ?? 0,
            color,
            (p.planetLevel ?? 0) <= 4
          );
        }
      }
    };

    ctx.globalAlpha = this.globalAlpha;

    renderPlanets(
      ctx,
      this.planetsOwner || [],
      this.ownColor,
      this.highlightStyle
    );
    if (this.playersFriendly.length > 0)
      renderPlanets(
        ctx,
        this.planetsFriendly || [],
        this.FriendlyColor,
        this.highlightStyle
      );
    if (this.playersNeutral.length > 0)
      renderPlanets(
        ctx,
        this.planetsNeutral || [],
        this.NeutralColor,
        this.highlightStyle
      );
    if (this.playersEnemy.length > 0)
      renderPlanets(
        ctx,
        this.planetsEnemy || [],
        this.EnemyColor,
        this.highlightStyle
      );

    ctx.globalAlpha = origGlobalAlpha;
    ctx.fillStyle = origFillStyle;
    ctx.strokeStyle = origStrokeStyle;
  }

  destroy() {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    if (this.selectHighlightStyle)
      this.selectHighlightStyle.removeEventListener(
        "change",
        this.highlightStyleHandler
      );
    if (this.sliderRange)
      this.sliderRange.removeEventListener("input", this.rangeHandler);
    if (this.sliderAlpha)
      this.sliderAlpha.removeEventListener("input", this.alphaHandler);
    if (this.sliderGlobalAlpha)
      this.sliderGlobalAlpha.removeEventListener(
        "input",
        this.globalAlphaHandler
      );
    this.statusEl = null;
  }
}

export default Plugin;
