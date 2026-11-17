import type { Player } from "@dfpunk/types";

export type ScoreboardRow = {
  address: Player["address"];
  score: number | undefined;
  rank: number | undefined;
};

/** Rank confirmed player scores; equal scores share a place (1, 2, 2, 4). */
export function buildScoreboard(players: Iterable<Player>): ScoreboardRow[] {
  const rows: ScoreboardRow[] = Array.from(players)
    .filter((player) => player.initTimestamp > 0)
    .map((player) => ({
      address: player.address,
      score:
        Number.isFinite(player.score) && player.score >= 0
          ? player.score
          : undefined,
      rank: undefined,
    }));
  rows.sort(
    (a, b) =>
      (b.score ?? -1) - (a.score ?? -1) ||
      a.address.toLowerCase().localeCompare(b.address.toLowerCase())
  );
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].score === undefined) continue;
    rows[i].rank =
      i > 0 && rows[i].score === rows[i - 1].score ? rows[i - 1].rank : i + 1;
  }
  return rows;
}

export function scoreboardRank(
  rows: ScoreboardRow[],
  account: string | undefined
): number | undefined {
  return account
    ? rows.find((row) => row.address.toLowerCase() === account.toLowerCase())
        ?.rank
    : undefined;
}
