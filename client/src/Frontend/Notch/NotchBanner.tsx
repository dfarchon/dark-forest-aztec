import {
  type AztecNode,
  createAztecNodeClient,
} from "@aztec-labs/aztec.js/node";
import React, { useEffect, useRef, useState } from "react";
import styled from "styled-components";

import { getEffectiveNodeUrl } from "../../config/connection";
import dfstyles from "../Styles/dfstyles";
import {
  formatNotchTime,
  NOTCH_BANNER_HEIGHT_PX,
  NOTCH_HOME_URL,
  NOTCH_POLL_MS,
  type NotchFeed,
  notchNodeOptions,
  type NotchPost,
  notchTickerText,
  readRecentNotchPosts,
} from "./notchBoard";

export { NOTCH_BANNER_HEIGHT_PX };

const BANNER_Z_INDEX = 5000;
const SCROLL_PIXELS_PER_SECOND = 48;

type BannerPhase = "loading" | "ready" | "unavailable";

let cachedNode: { url: string; node: AztecNode } | undefined;

function nodeFor(url: string): AztecNode {
  if (cachedNode?.url === url) return cachedNode.node;
  const node = createAztecNodeClient(url, notchNodeOptions(url));
  cachedNode = { url, node };
  return node;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

function useNotchFeed(): { phase: BannerPhase; feed?: NotchFeed } {
  const [phase, setPhase] = useState<BannerPhase>("loading");
  const [feed, setFeed] = useState<NotchFeed | undefined>();
  const feedRef = useRef<NotchFeed | undefined>(undefined);
  const generation = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let busy = false;

    const tick = async () => {
      if (busy) return;
      busy = true;
      const request = ++generation.current;
      let nodeUrl = "";
      try {
        nodeUrl = getEffectiveNodeUrl().trim();
        if (!nodeUrl) throw new Error("No node URL");
        const previous =
          feedRef.current?.nodeUrl === nodeUrl ? feedRef.current : undefined;
        const next = await readRecentNotchPosts(
          nodeFor(nodeUrl),
          nodeUrl,
          previous
        );
        if (
          cancelled ||
          request !== generation.current ||
          getEffectiveNodeUrl().trim() !== nodeUrl
        ) {
          return;
        }
        feedRef.current = next;
        setFeed(next);
        setPhase("ready");
      } catch {
        if (cancelled || request !== generation.current) return;
        const current = feedRef.current;
        if (!current || current.nodeUrl !== nodeUrl) {
          feedRef.current = undefined;
          setFeed(undefined);
          setPhase("unavailable");
        }
      } finally {
        busy = false;
      }
    };

    void tick();
    const timer = window.setInterval(() => void tick(), NOTCH_POLL_MS);
    return () => {
      cancelled = true;
      generation.current += 1;
      window.clearInterval(timer);
    };
  }, []);

  return { phase, feed };
}

function PostRun({
  posts,
  measureRef,
}: {
  posts: NotchPost[];
  measureRef?: React.Ref<HTMLSpanElement>;
}) {
  return (
    <Copy ref={measureRef}>
      {posts.map((post) => (
        <Item key={post.id}>
          {`#${post.id}  ${notchTickerText(post.text)}`}
          {post.publishedAt != null ? (
            <Time> {formatNotchTime(post.publishedAt)}</Time>
          ) : null}
        </Item>
      ))}
    </Copy>
  );
}

function Ticker({ posts, reduced }: { posts: NotchPost[]; reduced: boolean }) {
  const viewportRef = useRef<HTMLSpanElement>(null);
  const copyRef = useRef<HTMLSpanElement>(null);
  const [layout, setLayout] = useState<{
    copies: number;
    distance: number;
  } | null>(null);

  useEffect(() => {
    if (reduced) return;
    const measure = () => {
      const viewport = viewportRef.current;
      const copy = copyRef.current;
      if (!viewport || !copy) return;
      const distance = Math.round(copy.getBoundingClientRect().width);
      const viewportWidth = viewport.getBoundingClientRect().width;
      if (distance <= 0) return;
      const copies = Math.max(2, Math.ceil((viewportWidth * 2) / distance));
      setLayout((current) =>
        current?.copies === copies && current.distance === distance
          ? current
          : { copies, distance }
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (viewportRef.current) observer.observe(viewportRef.current);
    if (copyRef.current) observer.observe(copyRef.current);
    return () => observer.disconnect();
  }, [posts, reduced]);

  if (reduced) {
    return (
      <Viewport aria-hidden="true">
        <PostRun posts={posts.slice(0, 1)} />
      </Viewport>
    );
  }

  const copies = layout?.copies ?? 2;
  const distance = layout?.distance ?? 0;
  return (
    <Viewport ref={viewportRef} aria-hidden="true">
      <Track
        className="notch-track"
        $scroll={distance > 0}
        style={
          distance > 0
            ? {
                animationDuration: `${distance / SCROLL_PIXELS_PER_SECOND}s`,
                ["--notch-shift" as string]: `-${distance}px`,
              }
            : undefined
        }
      >
        {Array.from({ length: copies }, (_, index) => (
          <PostRun
            key={index}
            posts={posts}
            measureRef={index === 0 ? copyRef : undefined}
          />
        ))}
      </Track>
    </Viewport>
  );
}

export function NotchBanner() {
  const reduced = useReducedMotion();
  const { phase, feed } = useNotchFeed();
  const posts = feed?.posts ?? [];

  const status =
    phase === "unavailable" && posts.length === 0 ? "board unavailable" : "";

  return (
    <Bar
      aria-label={status ? "Notch board unavailable" : "Notch message board"}
    >
      <Mark>NOTCH</Mark>
      {status ? <Status>{status}</Status> : null}
      {posts.length > 0 ? (
        <Ticker posts={posts} reduced={reduced} />
      ) : (
        <Viewport />
      )}
      <OpenLink href={NOTCH_HOME_URL} target="_blank" rel="noreferrer">
        open
      </OpenLink>
    </Bar>
  );
}

const Bar = styled.div`
  position: fixed;
  z-index: ${BANNER_Z_INDEX};
  top: 0;
  right: 0;
  left: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  box-sizing: border-box;
  height: ${NOTCH_BANNER_HEIGHT_PX}px;
  padding: 0 10px;
  overflow: hidden;
  background: ${dfstyles.colors.background};
  color: ${dfstyles.colors.text};
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: ${NOTCH_BANNER_HEIGHT_PX}px;
  white-space: nowrap;
  text-decoration: none;
  user-select: none;

  &:hover .notch-track {
    animation-play-state: paused;
  }
`;

const OpenLink = styled.a`
  flex: 0 0 auto;
  height: 18px;
  padding: 0 8px;
  border: 1px solid ${dfstyles.colors.dfpink};
  border-radius: ${dfstyles.borderRadius};
  color: ${dfstyles.colors.dfpink};
  line-height: 16px;
  text-decoration: none;

  &:hover {
    color: ${dfstyles.colors.background};
    background: ${dfstyles.colors.dfpink};
  }

  &:focus-visible {
    outline: 1px solid ${dfstyles.colors.dfpink};
    outline-offset: 1px;
  }
`;

const Mark = styled.span`
  flex: 0 0 auto;
  color: ${dfstyles.colors.dfpink};
  letter-spacing: 0.08em;
`;

const Status = styled.span`
  color: ${dfstyles.colors.subtext};
`;

const Time = styled.span`
  color: ${dfstyles.colors.subtext};
  font-size: 10px;
`;

const Viewport = styled.span`
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
`;

const Track = styled.span<{ $scroll: boolean }>`
  display: inline-flex;
  white-space: nowrap;
  ${({ $scroll }) =>
    $scroll
      ? `
    animation-name: notch-marquee;
    animation-timing-function: linear;
    animation-iteration-count: infinite;

    @keyframes notch-marquee {
      from {
        transform: translateX(0);
      }
      to {
        transform: translateX(var(--notch-shift));
      }
    }

    @media (prefers-reduced-motion: reduce) {
      animation: none;
    }
  `
      : ""}
`;

const Copy = styled.span`
  display: inline-flex;
`;

const Item = styled.span`
  display: inline-block;
  padding-right: 4.5em;
`;
