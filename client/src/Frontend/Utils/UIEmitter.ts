import { EventEmitter } from "events";

export const enum UIEmitterEvent {
  GamePlanetSelected = "GamePlanetSelected",
  CenterPlanet = "CenterPlanet",
  WindowResize = "WindowResize",

  UIChange = "UIChange", // whenever you collapse, etc.

  CanvasMouseDown = "CanvasMouseDown",
  CanvasMouseMove = "CanvasMouseMove",
  CanvasMouseUp = "CanvasMouseUp",
  CanvasMouseOut = "CanvasMouseOut",
  CanvasScroll = "CanvasScroll",

  WorldMouseDown = "WorldMouseDown",
  WorldMouseClick = "WorldMouseClick",
  WorldMouseMove = "WorldMouseMove",
  WorldMouseUp = "WorldMouseUp",
  WorldMouseOut = "WorldMouseOut",

  ZoomIn = "ZoomIn",
  ZoomOut = "ZoomOut",

  SendInitiated = "SendInitiated",
  SendCancelled = "SendCancelled",
  // Local send gesture finished. Valid requests also carry (from, to, artifactId).
  // This does not mean the transaction has been submitted or confirmed.
  SendCompleted = "SendCompleted",
  // A local send check rejected the move, or the move request or submission failed.
  MoveFailed = "MoveFailed",
  ExplorerChanged = "ExplorerChanged",
  SetTerminalVisible = "SetTerminalVisible",
  TerminalVisibilityChanged = "TerminalVisibilityChanged",
  OpenScoringHelp = "OpenScoringHelp",

  OpenScoreboard = "OpenScoreboard",

  DepositArtifact = "DepositArtifact",
  DepositToPlanet = "DepositToPlanet",

  SelectArtifact = "SelectArtifact",
  ShowArtifact = "ShowArtifact",
}

class UIEmitter extends EventEmitter {
  static instance: UIEmitter;

  private constructor() {
    super();
  }

  static getInstance(): UIEmitter {
    if (!UIEmitter.instance) {
      UIEmitter.instance = new UIEmitter();
    }

    return UIEmitter.instance;
  }

  static initialize(): UIEmitter {
    const uiEmitter = new UIEmitter();

    return uiEmitter;
  }
}

export default UIEmitter;
