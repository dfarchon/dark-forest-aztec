import { ModalName } from "@dfpunk/types";
import React, { useEffect, useRef, useState } from "react";
import styled from "styled-components";

import { Btn } from "../../Components/Btn";
import { TextPreview } from "../../Components/TextPreview";
import dfstyles from "../../Styles/dfstyles";
import { useUIManager } from "../../Utils/AppHooks";
import { ModalPane } from "../../Views/ModalPane";
import { scoreboardRank } from "./scoreboard";
import { useScoreboard } from "./useScoreboard";

const PAGE_SIZE = 50;

export function ScoreboardPane({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const ui = useUIManager();
  const account = ui.getAccount();
  const { rows, loading, error, refresh } = useScoreboard(visible);
  const [page, setPage] = useState(0);
  const [locateRequest, setLocateRequest] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const myRowRef = useRef<HTMLTableRowElement>(null);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const rank = scoreboardRank(rows, account);
  const myIndex = rows.findIndex(
    (row) => row.address.toLowerCase() === account?.toLowerCase()
  );

  useEffect(() => {
    if (locateRequest === 0) return;
    const frame = requestAnimationFrame(() => {
      const content = contentRef.current;
      const row = myRowRef.current;
      if (!content || !row) return;
      content.scrollTop +=
        row.getBoundingClientRect().top -
        content.getBoundingClientRect().top -
        (content.clientHeight - row.clientHeight) / 2;
    });
    return () => cancelAnimationFrame(frame);
  }, [locateRequest]);

  return (
    <ModalPane
      id={ModalName.Leaderboard}
      title="Scoreboard"
      visible={visible}
      onClose={onClose}
    >
      <Content ref={contentRef}>
        <Summary>
          <span>
            Your rank: {rank === undefined ? "—" : `#${rank}`} ·{" "}
            {rows.length.toLocaleString()} players
          </span>
          {myIndex >= 0 && (
            <Btn
              size="small"
              onClick={() => {
                setPage(Math.floor(myIndex / PAGE_SIZE));
                setLocateRequest((request) => request + 1);
              }}
            >
              Find me
            </Btn>
          )}
        </Summary>
        {loading && <p role="status">Loading scoreboard…</p>}
        {error && (
          <p role="alert">
            Could not refresh the scoreboard.{" "}
            <Btn size="small" onClick={refresh}>
              Retry
            </Btn>
          </p>
        )}
        {!loading && !error && rows.length === 0 && (
          <p>No players have joined this game yet.</p>
        )}
        {rows.length > 0 && (
          <>
            <Scores>
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Player</th>
                  <th>Score</th>
                </tr>
              </thead>
              <tbody>
                {rows
                  .slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
                  .map((row) => {
                    const mine =
                      row.address.toLowerCase() === account?.toLowerCase();
                    return (
                      <tr
                        key={row.address}
                        ref={mine ? myRowRef : undefined}
                        data-current-player={mine || undefined}
                      >
                        <td>{row.rank === undefined ? "—" : `#${row.rank}`}</td>
                        <td>
                          <TextPreview
                            text={row.address}
                            focusedWidth="240px"
                            unFocusedWidth="180px"
                          />
                          {mine && <You>you</You>}
                        </td>
                        <td>{row.score?.toLocaleString() ?? "—"}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </Scores>
            {pages > 1 && (
              <Pagination>
                <Btn
                  size="small"
                  disabled={currentPage === 0}
                  onClick={() => setPage(currentPage - 1)}
                >
                  Previous
                </Btn>
                <span>
                  {currentPage + 1} / {pages}
                </span>
                <Btn
                  size="small"
                  disabled={currentPage + 1 >= pages}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Next
                </Btn>
              </Pagination>
            )}
            <Note>
              Equal scores share the same rank. Updates follow confirmed game
              state.
            </Note>
          </>
        )}
      </Content>
    </ModalPane>
  );
}

const Content = styled.div`
  width: min(540px, calc(100vw - 64px));
  max-height: min(560px, calc(100vh - 160px));
  overflow: auto;
  padding: 4px;
`;
const Summary = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
`;
const Scores = styled.table`
  width: 100%;
  border-collapse: collapse;
  th,
  td {
    padding: 8px;
    text-align: left;
    white-space: nowrap;
  }
  th {
    color: ${dfstyles.colors.subtext};
    border-bottom: 1px solid ${dfstyles.colors.borderDark};
  }
  th:last-child,
  td:last-child {
    text-align: right;
  }
  tr[data-current-player] {
    color: ${dfstyles.colors.dfpink};
    background: rgba(255, 180, 193, 0.08);
  }
`;
const You = styled.span`
  margin-left: 8px;
  color: ${dfstyles.colors.dfpink};
`;
const Note = styled.p`
  color: ${dfstyles.colors.subtext};
  font-size: ${dfstyles.fontSizeXS};
  margin: 16px 0 0;
`;
const Pagination = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 12px;
`;
