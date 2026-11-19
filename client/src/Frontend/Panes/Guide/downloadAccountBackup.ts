import type GameUIManager from "../../../Backend/GameLogic/GameUIManager";

export type AccountBackupDownloadResult =
  | "downloaded"
  | "incomplete"
  | "failed";

export function canPrepareAccountBackup(ui: GameUIManager): boolean {
  const credentials = ui.getAccountCredentials();
  const account = ui.getAccount();
  const homeCoordinates = ui.getGameManager().getHomeCoords();
  return Boolean(
    credentials?.secretKey &&
    credentials.salt &&
    credentials.signingKey &&
    account &&
    homeCoordinates
  );
}

export function downloadAccountBackup(
  ui: GameUIManager
): AccountBackupDownloadResult {
  const credentials = ui.getAccountCredentials();
  const account = ui.getAccount();
  const homeCoordinates = ui.getGameManager().getHomeCoords();

  if (
    !credentials?.secretKey ||
    !credentials.salt ||
    !credentials.signingKey ||
    !account ||
    !homeCoordinates
  ) {
    return "incomplete";
  }

  try {
    const payload = {
      secretKey: credentials.secretKey,
      salt: credentials.salt,
      signingKey: credentials.signingKey,
      address: account,
      homeCoordinates: {
        x: homeCoordinates.x,
        y: homeCoordinates.y,
      },
    };
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const accountString = String(account);
    const safeAddr =
      accountString.length >= 10 ? accountString.slice(0, 10) : "account";
    a.download = `dark-forest-privacy-${safeAddr}.json`;
    a.click();
    URL.revokeObjectURL(url);
    return "downloaded";
  } catch (err) {
    console.error("Failed to download account backup:", err);
    return "failed";
  }
}
