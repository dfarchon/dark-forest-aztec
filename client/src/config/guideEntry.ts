/** A guide entry changes the in-game overlay, never the wallet or fee policy. */
export function isGuideEntry(search: string): boolean {
  return new URLSearchParams(search).get("guide") === "1";
}

export function clearGuideSearch(search: string): string {
  const params = new URLSearchParams(search);
  params.delete("guide");
  const remaining = params.toString();
  return remaining ? `?${remaining}` : "";
}

export function quickGuidePlayPath(contract: string, search = ""): string {
  const params = new URLSearchParams(search);
  // Old booth bookmarks must use the normal QuickGame home search too.
  params.delete("booth");
  params.delete("searchCenter");
  params.set("guide", "1");
  return `/play/${contract}?${params}`;
}
