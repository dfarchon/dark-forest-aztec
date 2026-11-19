import { useEffect, useState } from "react";

import { useUIManager } from "../../Utils/AppHooks";
import { buildScoreboard, type ScoreboardRow } from "./scoreboard";

/** Read the live indexer snapshot through the existing read API; no transactions or extra RPCs. */
export function useScoreboard(enabled = true) {
  const ui = useUIManager();
  const [rows, setRows] = useState<ScoreboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error>();
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let request = 0;
    const load = async () => {
      const current = ++request;
      try {
        const players = await ui.getGameManager().getContractAPI().getPlayers();
        if (!active || current !== request) return;
        setRows(buildScoreboard(players.values()));
        setError(undefined);
      } catch (cause) {
        if (!active || current !== request) return;
        setError(cause instanceof Error ? cause : new Error(String(cause)));
      } finally {
        if (active && current === request) setLoading(false);
      }
    };
    const subscription = ui.getEthConnection().blockNumber$.subscribe(() => {
      void load();
    });
    if (request === 0) void load();
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [ui, enabled, reload]);

  return {
    rows,
    loading,
    error,
    refresh: () => setReload((value) => value + 1),
  };
}
