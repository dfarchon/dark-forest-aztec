/**
 * BGM Radio — Queue and play local audio files or YouTube embeds.
 * Embedded plugin for dfpunk-aztec. No df/ui required. Dark theme styling.
 */

const btnStyle = {
  background: "#3d444c",
  color: "#e4e4e4",
  border: "1px solid #5a6268",
  borderRadius: "5px",
  padding: "10px",
  cursor: "pointer",
  fontSize: "13px",
};

const btnDangerStyle = {
  ...btnStyle,
  background: "#6b2d2d",
};

class Plugin {
  constructor() {
    this.queue = [];
    this.currentTrackIndex = 0;
    this.audioElement = null;
    this.youtubeIframe = null;
    this.queueListEl = null;
  }

  render(container) {
    container.style.width = "400px";
    container.style.minHeight = "400px";
    container.style.border = "1px solid #5a6268";
    container.style.padding = "15px";
    container.style.borderRadius = "10px";
    container.style.overflowY = "auto";
    container.style.overflowX = "hidden";
    container.style.backgroundColor = "#252525";

    container.innerHTML = `
      <div id="music-player">
        <h2 style="text-align: center; color: #e4e4e4;">BGM RADIO</h2>
        <audio id="audio-element" controls style="width: 100%; margin-top: 10px;"></audio>
        <iframe
          id="youtube-iframe"
          style="display: none; width: 100%; height: 200px; margin-top: 10px;"
          frameborder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowfullscreen
        ></iframe>

        <div style="margin-top: 15px;">
          <input type="file" id="file-input" accept="audio/*" multiple style="width: 100%; color: #e4e4e4; background: #3d444c; border: 1px solid #5a6268; border-radius: 4px; padding: 6px;" />
          <input
            type="text"
            id="youtube-link"
            placeholder="YouTube link"
            style="width: 100%; margin-top: 10px; padding: 6px; color: #e4e4e4; background: #3d444c; border: 1px solid #5a6268; border-radius: 4px; box-sizing: border-box;"
          />
          <button id="add-button" style="width: 100%; margin-top: 10px; padding: 10px; background: #3d444c; color: #e4e4e4; border: 1px solid #5a6268; border-radius: 5px; cursor: pointer;">
            Add to Queue
          </button>
        </div>

        <ul id="queue-list" style="list-style: none; padding: 0; margin-top: 20px; max-height: 150px; overflow-y: auto; border: 1px solid #5a6268; border-radius: 5px; color: #e4e4e4;"></ul>

        <div style="margin-top: 20px; text-align: center;">
          <button id="prev-button" style="padding: 10px 20px; margin-right: 10px; background: #3d444c; color: #e4e4e4; border: 1px solid #5a6268; border-radius: 5px; cursor: pointer;">
            Previous
          </button>
          <button id="next-button" style="padding: 10px 20px; background: #3d444c; color: #e4e4e4; border: 1px solid #5a6268; border-radius: 5px; cursor: pointer;">
            Next
          </button>
        </div>
      </div>
    `;

    this.audioElement = container.querySelector("#audio-element");
    this.youtubeIframe = container.querySelector("#youtube-iframe");
    this.queueListEl = container.querySelector("#queue-list");
    this.bindEvents(container);
  }

  bindEvents(container) {
    const fileInput = container.querySelector("#file-input");
    const youtubeInput = container.querySelector("#youtube-link");
    const addButton = container.querySelector("#add-button");
    const queueList = container.querySelector("#queue-list");
    const prevButton = container.querySelector("#prev-button");
    const nextButton = container.querySelector("#next-button");

    addButton.addEventListener("click", () => {
      const youtubeLink = youtubeInput.value.trim();
      if (youtubeLink) {
        const videoId = this.extractYouTubeID(youtubeLink);
        if (videoId) {
          this.addToQueue({
            type: "youtube",
            url: `https://www.youtube.com/embed/${videoId}`,
            name: "YouTube Video",
          });
          youtubeInput.value = "";
        } else {
          alert("Invalid YouTube URL!");
        }
      } else if (fileInput.files && fileInput.files.length > 0) {
        Array.from(fileInput.files).forEach((file) => {
          this.addToQueue({
            type: "local",
            url: URL.createObjectURL(file),
            name: file.name,
          });
        });
        fileInput.value = "";
      }
      this.updateQueueList(queueList);
    });

    queueList.addEventListener("click", (event) => {
      if (event.target.tagName === "BUTTON") {
        const index = parseInt(event.target.dataset.index, 10);
        this.removeFromQueue(index);
        this.updateQueueList(queueList);
      }
    });

    prevButton.addEventListener("click", () => this.playPrevious());
    nextButton.addEventListener("click", () => this.playNext());
  }

  addToQueue(track) {
    this.queue.push(track);
    if (this.queue.length === 1) this.playTrack(0);
  }

  removeFromQueue(index) {
    if (index >= 0 && index < this.queue.length) {
      const track = this.queue[index];
      if (track.type === "local" && track.url) URL.revokeObjectURL(track.url);
      this.queue.splice(index, 1);
      if (index === this.currentTrackIndex) {
        this.playTrack(Math.min(this.currentTrackIndex, this.queue.length - 1));
      } else if (index < this.currentTrackIndex) {
        this.currentTrackIndex -= 1;
      }
    }
  }

  updateQueueList(queueList) {
    const list = queueList || this.queueListEl;
    if (!list) return;
    list.innerHTML = this.queue
      .map(
        (track, index) => `
          <li style="padding: 8px; border-bottom: 1px solid #5a6268; display: flex; justify-content: space-between; align-items: center;">
            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">${track.name || track.url || "Track"}</span>
            <button data-index="${index}" style="background: #6b2d2d; color: #e4e4e4; border: 1px solid #5a6268; border-radius: 3px; padding: 5px 8px; font-size: 12px; cursor: pointer; margin-left: 8px;">✖</button>
          </li>
        `
      )
      .join("");
  }

  playTrack(index) {
    if (index < 0 || index >= this.queue.length) {
      if (this.audioElement) {
        this.audioElement.pause();
        this.audioElement.removeAttribute("src");
      }
      if (this.youtubeIframe) {
        this.youtubeIframe.style.display = "none";
        this.youtubeIframe.removeAttribute("src");
      }
      return;
    }

    const track = this.queue[index];
    this.currentTrackIndex = index;

    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.removeAttribute("src");
    }
    if (this.youtubeIframe) {
      this.youtubeIframe.style.display = "none";
      this.youtubeIframe.removeAttribute("src");
    }

    if (track.type === "local") {
      this.audioElement.style.display = "block";
      this.audioElement.src = track.url;
      this.audioElement.play().catch(() => {});
    } else if (track.type === "youtube") {
      this.audioElement.style.display = "none";
      this.youtubeIframe.style.display = "block";
      this.youtubeIframe.src = `${track.url}?autoplay=1`;
    }
  }

  playNext() {
    if (this.queue.length > 0) {
      const nextIndex = (this.currentTrackIndex + 1) % this.queue.length;
      this.playTrack(nextIndex);
    }
  }

  playPrevious() {
    if (this.queue.length > 0) {
      const prevIndex =
        (this.currentTrackIndex - 1 + this.queue.length) % this.queue.length;
      this.playTrack(prevIndex);
    }
  }

  extractYouTubeID(url) {
    const regExp =
      /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/;
    const match = String(url).match(regExp);
    return match ? match[1] : null;
  }

  destroy() {
    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.removeAttribute("src");
      this.audioElement = null;
    }
    if (this.youtubeIframe) {
      this.youtubeIframe.removeAttribute("src");
      this.youtubeIframe.style.display = "none";
      this.youtubeIframe = null;
    }
    this.queue.forEach((track) => {
      if (track.type === "local" && track.url) URL.revokeObjectURL(track.url);
    });
    this.queue = [];
    this.queueListEl = null;
  }
}

export default Plugin;
