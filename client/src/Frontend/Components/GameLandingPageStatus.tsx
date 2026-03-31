import React, { useEffect, useState } from "react";

import type { IndexerConnection } from "../../Session/Indexer/IndexerConnection";

export function BlockSyncStatus({
  connection,
}: {
  connection: IndexerConnection;
}) {
  const [blockNum, setBlockNum] = useState<number>(
    connection.getCurrentBlockNumber()
  );

  useEffect(() => {
    const sub = connection.blockNumber$.subscribe((n) => setBlockNum(n));
    return () => sub.unsubscribe();
  }, [connection]);

  return (
    <div
      style={{
        flexShrink: 0,
        borderTop: "1px solid #333",
        padding: "4px 8px",
        fontSize: "11px",
        fontFamily: "monospace",
        color: "#666",
        display: "flex",
        alignItems: "center",
        gap: "6px",
      }}
    >
      <span style={{ color: "#5b5" }}>●</span>
      Block {blockNum}
    </div>
  );
}
