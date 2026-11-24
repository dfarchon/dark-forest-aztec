import {
  type AztecNode,
  createAztecNodeClient,
} from "@aztec-labs/aztec.js/node";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import styled from "styled-components";

import { getEffectiveNodeUrl } from "../../config/connection";
import dfstyles from "../Styles/dfstyles";
import {
  formatNotchTime,
  mergeNotchTickerPosts,
  NOTCH_BANNER_HEIGHT_PX,
  NOTCH_HOME_URL,
  NOTCH_POLL_MS,
  notchCanRetarget,
  type NotchFeed,
  notchIdsGrow,
  notchNodeOptions,
  type NotchPost,
  notchRetargetOffset,
  notchTickerText,
  readNotchBoard,
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
        const stale = () =>
          cancelled ||
          request !== generation.current ||
          getEffectiveNodeUrl().trim() !== nodeUrl;
        await readNotchBoard(
          nodeFor(nodeUrl),
          nodeUrl,
          previous,
          (next) => {
            if (stale()) return;
            feedRef.current = next;
            setFeed(next);
            setPhase("ready");
          },
          stale
        );
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

function sameIds(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function notchCopyCount(
  distance: number,
  viewportWidth: number,
  lockLoop: boolean
): number {
  if (distance <= 0 || viewportWidth <= 0) return 0;
  if (!lockLoop && distance <= viewportWidth) return 1;
  return Math.max(2, Math.ceil((viewportWidth * 2) / distance));
}

function placeNotchTrack(
  track: HTMLElement | null,
  offset: number,
  distance: number
) {
  if (!track) return;
  const shift = distance > 0 ? offset % distance : 0;
  track.style.transform = `translate3d(${-shift}px,0,0)`;
}

function Ticker({
  posts,
  reduced,
  pausedRef,
  complete,
}: {
  posts: NotchPost[];
  reduced: boolean;
  pausedRef: React.MutableRefObject<boolean>;
  complete: boolean;
}) {
  if (reduced) {
    return (
      <Viewport aria-hidden="true">
        <PostRun posts={posts.slice(0, 1)} />
      </Viewport>
    );
  }
  return (
    <SmoothTicker posts={posts} pausedRef={pausedRef} complete={complete} />
  );
}

function SmoothTicker({
  posts,
  pausedRef,
  complete,
}: {
  posts: NotchPost[];
  pausedRef: React.MutableRefObject<boolean>;
  complete: boolean;
}) {
  const viewportRef = useRef<HTMLSpanElement>(null);
  const trackRef = useRef<HTMLSpanElement>(null);
  const copyRef = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(posts);
  const [copies, setCopies] = useState(1);
  const shownRef = useRef(posts);
  const pendingRef = useRef<NotchPost[] | null>(null);
  const offsetRef = useRef(0);
  const distanceRef = useRef(0);
  const viewportWidthRef = useRef(0);
  const prefixRef = useRef(0);
  const loopRef = useRef(false);
  const completeRef = useRef(complete);
  const applyPendingRef = useRef(() => {});
  completeRef.current = complete;

  const shownIds = shownRef.current.map((post) => post.id);
  const desired = mergeNotchTickerPosts(shownRef.current, posts);
  const desiredIds = desired.map((post) => post.id);
  pendingRef.current = sameIds(shownIds, desiredIds) ? null : desired;

  applyPendingRef.current = () => {
    const pending = pendingRef.current;
    if (!pending) return;
    const nextIds = pending.map((post) => post.id);
    if (
      sameIds(
        shownRef.current.map((post) => post.id),
        nextIds
      )
    ) {
      pendingRef.current = null;
      return;
    }
    const grow = notchIdsGrow(
      shownRef.current.map((post) => post.id),
      nextIds
    );
    if (
      grow &&
      !notchCanRetarget(
        offsetRef.current,
        distanceRef.current,
        viewportWidthRef.current
      )
    ) {
      return;
    }
    if (!grow) offsetRef.current = 0;
    prefixRef.current = grow?.prefix ?? 0;
    pendingRef.current = null;
    shownRef.current = pending;
    setShown(pending);
  };

  useLayoutEffect(() => {
    const copy = copyRef.current;
    const viewport = viewportRef.current;
    if (!copy || !viewport) return;
    const distance = copy.getBoundingClientRect().width;
    const viewportWidth = viewport.getBoundingClientRect().width;
    const prefix = prefixRef.current;
    prefixRef.current = 0;
    const looping = distance > viewportWidth && viewportWidth > 0;
    if (looping && prefix > 0) {
      let prefixWidth = 0;
      const children = copy.children;
      for (let index = 0; index < prefix && index < children.length; index++) {
        prefixWidth += children[index].getBoundingClientRect().width;
      }
      offsetRef.current = notchRetargetOffset(
        offsetRef.current,
        distance,
        viewportWidth,
        prefixWidth
      );
    } else if (
      !loopRef.current &&
      viewportWidth > 0 &&
      distance > 0 &&
      !looping
    ) {
      offsetRef.current = 0;
    } else if (distance > 0 && offsetRef.current >= distance) {
      offsetRef.current %= distance;
    }
    distanceRef.current = distance;
    viewportWidthRef.current = viewportWidth;
    placeNotchTrack(trackRef.current, offsetRef.current, distance);
    const lockLoop =
      loopRef.current || (complete && pendingRef.current == null);
    const needed = notchCopyCount(distance, viewportWidth, lockLoop);
    if (needed >= 2) loopRef.current = true;
    if (needed > 0 && needed !== copies) {
      setCopies(needed);
      return;
    }
    applyPendingRef.current();
  }, [shown, copies, posts, complete]);

  useEffect(() => {
    const viewport = viewportRef.current;
    const copy = copyRef.current;
    if (!viewport || !copy) return;
    const measure = () => {
      const distance = copy.getBoundingClientRect().width;
      const viewportWidth = viewport.getBoundingClientRect().width;
      if (distance > 0 && offsetRef.current >= distance) {
        offsetRef.current %= distance;
      }
      distanceRef.current = distance;
      viewportWidthRef.current = viewportWidth;
      placeNotchTrack(trackRef.current, offsetRef.current, distance);
      const lockLoop =
        loopRef.current || (completeRef.current && pendingRef.current == null);
      const needed = notchCopyCount(distance, viewportWidth, lockLoop);
      if (needed >= 2) loopRef.current = true;
      if (needed > 0) {
        setCopies((current) => (current === needed ? current : needed));
      }
      applyPendingRef.current();
    };
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(copy);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const dt = Math.min(32, Math.max(0, now - last));
      last = now;
      applyPendingRef.current();
      if (document.hidden || pausedRef.current) return;
      const distance = distanceRef.current;
      const viewportWidth = viewportWidthRef.current;
      if (distance <= 0 || (!loopRef.current && distance <= viewportWidth)) {
        return;
      }
      offsetRef.current += (SCROLL_PIXELS_PER_SECOND * dt) / 1000;
      if (offsetRef.current >= distance) offsetRef.current %= distance;
      placeNotchTrack(trackRef.current, offsetRef.current, distance);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [pausedRef]);

  return (
    <Viewport ref={viewportRef} aria-hidden="true">
      <Track ref={trackRef} className="notch-track">
        {Array.from({ length: copies }, (_, index) => (
          <PostRun
            key={index}
            posts={shown}
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
  const pausedRef = useRef(false);

  const status =
    phase === "unavailable" && posts.length === 0 ? "board unavailable" : "";

  return (
    <Bar
      aria-label={status ? "Notch board unavailable" : "Notch message board"}
      onMouseEnter={() => {
        pausedRef.current = true;
      }}
      onMouseLeave={() => {
        pausedRef.current = false;
      }}
    >
      <Mark>NOTCH</Mark>
      {status ? <Status>{status}</Status> : null}
      {posts.length > 0 ? (
        <Ticker
          posts={posts}
          reduced={reduced}
          pausedRef={pausedRef}
          complete={feed?.complete ?? false}
        />
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

const Track = styled.span`
  display: inline-flex;
  white-space: nowrap;
  will-change: transform;
`;

const Copy = styled.span`
  display: inline-flex;
`;

const Item = styled.span`
  display: inline-block;
  padding-right: 4.5em;
`;
