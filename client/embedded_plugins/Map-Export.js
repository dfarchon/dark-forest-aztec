/**
 * Map Export — Export/import explored map with optional coordinate filter.
 * Embedded plugin for dfpunk-aztec. Uses only globals df + ui.
 * Export: copy to clipboard or download JSON. Import: from clipboard or file.
 * Clear selected map: not available (no bulkDeleteChunks in this client).
 */

const viewport = ui.getViewport();

const btnStyle = {
  background: "#3d444c",
  color: "#e4e4e4",
  border: "1px solid #5a6268",
  borderRadius: "4px",
  padding: "6px 10px",
  cursor: "pointer",
  fontSize: "13px",
};

class Plugin {
  constructor() {
    this.beginCoords = null;
    this.endCoords = null;

    this.status = document.createElement("div");
    this.status.style.marginTop = "10px";
    this.status.style.textAlign = "center";

    this.xyWrapper = document.createElement("div");
    this.xyWrapper.style.marginBottom = "10px";

    const msg = document.createElement("div");
    msg.innerText = "Click on the map to pin selection.";
    this.beginXY = document.createElement("div");
    this.endXY = document.createElement("div");

    const clear = document.createElement("button");
    clear.innerText = "Clear selection";
    Object.assign(clear.style, btnStyle);
    clear.style.width = "100%";
    clear.onclick = () => {
      this.beginCoords = null;
      this.beginXY.innerText = "Begin: ???";
      this.endCoords = null;
      this.endXY.innerText = "";
    };

    this.xyWrapper.appendChild(msg);
    this.xyWrapper.appendChild(this.beginXY);
    this.xyWrapper.appendChild(this.endXY);
    this.xyWrapper.appendChild(clear);
  }

  async processMap(input) {
    let chunks;
    try {
      chunks = JSON.parse(input);
    } catch (err) {
      console.error(err);
      this.status.innerText = "Invalid map data. Check the data in your file.";
      this.status.style.color = "#f58f8f";
      return;
    }

    this.status.innerText = "Importing, this will take awhile...";
    this.status.style.color = "#e4e4e4";
    try {
      if (typeof df.bulkAddNewChunks !== "function") {
        this.status.innerText =
          "Import not available (bulkAddNewChunks missing).";
        this.status.style.color = "#f58f8f";
        return;
      }
      await df.bulkAddNewChunks(chunks);
      this.status.innerText = "Successfully imported map!";
    } catch (err) {
      console.error(err);
      this.status.innerText = "Encountered an unexpected error.";
      this.status.style.color = "#f58f8f";
    }
  }

  onImport = async () => {
    let input;
    try {
      input = await window.navigator.clipboard.readText();
    } catch (err) {
      console.error(err);
      this.status.innerText =
        "Unable to import map. Did you allow clipboard access?";
      this.status.style.color = "#f58f8f";
      return;
    }
    this.processMap(input);
  };

  onUpload = async () => {
    const inputFile = document.createElement("input");
    inputFile.type = "file";
    inputFile.onchange = () => {
      try {
        const file = inputFile.files.item(0);
        const reader = new FileReader();
        reader.onload = () => {
          this.processMap(reader.result);
        };
        reader.readAsText(file);
      } catch (err) {
        console.error(err);
        this.status.innerText = "Unable to upload map.";
        this.status.style.color = "#f58f8f";
      }
    };
    inputFile.click();
  };

  intersectsXY(chunk, begin, end) {
    const chunkLeft = chunk.chunkFootprint.bottomLeft.x;
    const chunkRight = chunkLeft + chunk.chunkFootprint.sideLength;
    const chunkBottom = chunk.chunkFootprint.bottomLeft.y;
    const chunkTop = chunkBottom + chunk.chunkFootprint.sideLength;

    return (
      chunkLeft >= begin.x &&
      chunkRight <= end.x &&
      chunkTop <= begin.y &&
      chunkBottom >= end.y
    );
  }

  generateMap() {
    const chunks = ui.getExploredChunks();
    let chunksAsArray = Array.from(chunks);
    if (this.beginCoords && this.endCoords) {
      const begin = {
        x: Math.min(this.beginCoords.x, this.endCoords.x),
        y: Math.max(this.beginCoords.y, this.endCoords.y),
      };
      const end = {
        x: Math.max(this.beginCoords.x, this.endCoords.x),
        y: Math.min(this.beginCoords.y, this.endCoords.y),
      };
      chunksAsArray = chunksAsArray.filter((chunk) =>
        this.intersectsXY(chunk, begin, end)
      );
    }
    return chunksAsArray;
  }

  onExport = async () => {
    const mapRaw = this.generateMap();
    try {
      const map = JSON.stringify(mapRaw);
      await window.navigator.clipboard.writeText(map);
      this.status.innerText = "Map copied to clipboard!";
      this.status.style.color = "#e4e4e4";
    } catch (err) {
      console.error(err);
      this.status.innerText = "Failed to export map.";
      this.status.style.color = "#f58f8f";
    }
  };

  onDownload = async () => {
    const mapRaw = this.generateMap();
    try {
      const map = JSON.stringify(mapRaw);
      const addr =
        typeof df.getContractAddress === "function"
          ? String(df.getContractAddress()).slice(0, 8)
          : "map";
      const blob = new Blob([map], { type: "application/json" });
      const anchor = document.createElement("a");
      anchor.download = addr + "_map.json";
      anchor.href = (window.URL || window.webkitURL).createObjectURL(blob);
      anchor.click();
      if (anchor.href) URL.revokeObjectURL(anchor.href);
      this.status.innerText = "Saving map!";
      this.status.style.color = "#e4e4e4";
    } catch (err) {
      console.error(err);
      this.status.innerText = "Failed to download map.";
      this.status.style.color = "#f58f8f";
    }
  };

  onMouseMove = () => {
    const coords = ui.getHoveringOverCoords?.();
    if (coords) {
      if (this.beginCoords == null) {
        this.beginXY.innerText = `Begin: (${coords.x}, ${coords.y})`;
        return;
      }
      if (this.endCoords == null) {
        this.endXY.innerText = `End: (${coords.x}, ${coords.y})`;
      }
    }
  };

  onClick = () => {
    const coords = ui.getHoveringOverCoords?.();
    if (coords) {
      if (this.beginCoords == null) {
        this.beginCoords = coords;
        return;
      }
      if (this.endCoords == null) {
        this.endCoords = coords;
      }
    }
  };

  onClearMap = async () => {
    if (typeof df.bulkDeleteChunks !== "function") {
      this.status.innerText = "Clear map is not available in this client.";
      this.status.style.color = "#f58f8f";
      return;
    }
    const chunks = this.generateMap();
    if (
      !confirm(
        `Are you sure you want to delete ${chunks.length} chunks from the map?`
      )
    ) {
      return;
    }
    this.status.innerText = "Clearing map, this may take a while...";
    this.status.style.color = "#e4e4e4";
    try {
      await df.bulkDeleteChunks(chunks);
      this.beginCoords = null;
      this.beginXY.innerText = "Begin: ???";
      this.endCoords = null;
      this.endXY.innerText = "";
      this.status.innerText = "Map cleared successfully!";
    } catch (err) {
      console.error(err);
      this.status.innerText = "Failed to clear map.";
      this.status.style.color = "#f58f8f";
    }
  };

  render(container) {
    if (container.parentElement)
      container.parentElement.style.minHeight = "unset";
    container.style.minHeight = "unset";
    container.style.width = "400px";

    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("click", this.onClick);

    const wrapper = document.createElement("div");
    wrapper.style.display = "flex";
    wrapper.style.justifyContent = "space-between";
    wrapper.style.marginBottom = "10px";

    const wrapper2 = document.createElement("div");
    wrapper2.style.display = "flex";
    wrapper2.style.justifyContent = "space-between";

    const exportButton = document.createElement("button");
    exportButton.innerText = "Copy Map to Clipboard";
    Object.assign(exportButton.style, btnStyle);
    exportButton.onclick = this.onExport;

    const importButton = document.createElement("button");
    importButton.innerText = "Load Map from Clipboard";
    Object.assign(importButton.style, btnStyle);
    importButton.onclick = this.onImport;

    const downloadButton = document.createElement("button");
    downloadButton.innerText = "Download Map as File";
    Object.assign(downloadButton.style, btnStyle);
    downloadButton.onclick = this.onDownload;

    const uploadButton = document.createElement("button");
    uploadButton.innerText = "Upload Map from File";
    Object.assign(uploadButton.style, btnStyle);
    uploadButton.onclick = this.onUpload;

    wrapper.appendChild(exportButton);
    wrapper.appendChild(importButton);
    wrapper2.appendChild(downloadButton);
    wrapper2.appendChild(uploadButton);

    const wrapper3 = document.createElement("div");
    wrapper3.style.display = "flex";
    wrapper3.style.justifyContent = "center";
    wrapper3.style.marginTop = "10px";

    const clearMapButton = document.createElement("button");
    clearMapButton.innerText = "Clear Selected Map";
    Object.assign(clearMapButton.style, {
      ...btnStyle,
      backgroundColor: "#6b2d2d",
      color: "#e4e4e4",
    });
    clearMapButton.onclick = this.onClearMap;

    wrapper3.appendChild(clearMapButton);

    container.appendChild(this.xyWrapper);
    container.appendChild(wrapper);
    container.appendChild(wrapper2);
    container.appendChild(wrapper3);
    container.appendChild(this.status);
  }

  draw(ctx) {
    const begin = this.beginCoords;
    const end = this.endCoords || ui.getHoveringOverCoords?.();
    if (begin && end) {
      const beginX = Math.min(begin.x, end.x);
      const beginY = Math.max(begin.y, end.y);
      const endX = Math.max(begin.x, end.x);
      const endY = Math.min(begin.y, end.y);
      const width = endX - beginX;
      const height = beginY - endY;
      const topLeft =
        typeof viewport.worldToCanvasCoords === "function"
          ? viewport.worldToCanvasCoords({ x: beginX, y: beginY })
          : { x: 0, y: 0 };
      const wPx =
        typeof viewport.worldToCanvasDist === "function"
          ? viewport.worldToCanvasDist(width)
          : width;
      const hPx =
        typeof viewport.worldToCanvasDist === "function"
          ? viewport.worldToCanvasDist(height)
          : height;

      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.lineWidth = 1;
      ctx.strokeRect(topLeft.x, topLeft.y, wPx, hPx);
      ctx.restore();
    }
  }

  destroy() {
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("click", this.onClick);
  }
}

export default Plugin;
