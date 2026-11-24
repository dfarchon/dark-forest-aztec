import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeNotchMessage,
  formatNotchTickerItem,
  mergeNotchTickerPosts,
  notchCanRetarget,
  notchIdsGrow,
  notchIdsToRead,
  notchRetargetOffset,
  type NotchPost,
  notchTickerText,
  packNotchMessage,
  sortNotchPostsByRecency,
} from "../src/Frontend/Notch/notchBoard.ts";

test("round-trips short, multibyte, and multi-field Notch posts", () => {
  for (const message of ["A", "hello", "你好", `${"x".repeat(40)}\nnext`]) {
    const packed = packNotchMessage(message);
    assert.equal(packed.fields.length, 17);
    assert.equal(decodeNotchMessage(packed.fields, packed.length), message);
  }
});

test("rejects an empty, oversized, short, or padded post", () => {
  assert.throws(() => packNotchMessage(""), /1–512/);
  assert.throws(() => packNotchMessage("a".repeat(513)), /1–512/);
  assert.throws(() => packNotchMessage("\uD800"), /Unicode/);

  const packed = packNotchMessage("hi");
  assert.throws(() => decodeNotchMessage(packed.fields, 0), /shape/);
  assert.throws(() => decodeNotchMessage(packed.fields, 513), /shape/);
  assert.throws(
    () => decodeNotchMessage(packed.fields.slice(0, 16), packed.length),
    /shape/
  );
  const padded = [...packed.fields];
  padded[0] += 1n;
  assert.throws(() => decodeNotchMessage(padded, packed.length), /padding/);
  assert.throws(
    () => decodeNotchMessage([1n << 248n, ...packed.fields.slice(1)], 1),
    /packed field/
  );
});

test("collapses whitespace and caps ticker length", () => {
  assert.equal(notchTickerText("  a\n\nb \t c  "), "a b c");
  const long = notchTickerText("word ".repeat(80));
  assert.equal(long.length, 160);
  assert.ok(long.endsWith("…"));
  assert.equal(long.includes("\n"), false);
});

test("formats a ticker item as local clock then date", () => {
  const when = new Date(2026, 10, 22, 17, 30, 0);
  const publishedAt = Math.floor(when.getTime() / 1000);
  const month = when.toLocaleString("en-US", { month: "short" });
  assert.equal(
    formatNotchTickerItem({ id: 4, text: "hello\nthere", publishedAt }),
    `#4  hello there  17:30 ${month} 22`
  );
});

function post(id: number, publishedAt?: number): NotchPost {
  return {
    id,
    text: `m${id}`,
    ...(publishedAt == null ? {} : { publishedAt }),
  };
}

test("sorts posts by newest time, then higher id", () => {
  const sorted = sortNotchPostsByRecency([
    post(1, 10),
    post(4),
    post(3, 30),
    post(2, 30),
    post(5, 20),
  ]);
  assert.deepEqual(
    sorted.map((item) => item.id),
    [3, 2, 5, 1, 4]
  );
});

test("plans unread ids from newest to oldest", () => {
  assert.deepEqual(notchIdsToRead(5, []), [4, 3, 2, 1, 0]);
  assert.deepEqual(notchIdsToRead(5, [4, 3]), [2, 1, 0]);
  assert.deepEqual(notchIdsToRead(6, [0, 1, 2, 3, 4]), [5]);
  assert.deepEqual(notchIdsToRead(3, [1]), [2, 0]);
  assert.deepEqual(notchIdsToRead(0, []), []);
});

test("keeps the visible ticker order and only extends its ends", () => {
  const shown = [post(8, 80), post(7, 70), post(6, 40)];
  const withOlder = mergeNotchTickerPosts(shown, [
    ...shown,
    post(5, 50),
    post(4, 30),
  ]);
  assert.deepEqual(
    withOlder.map((item) => item.id),
    [8, 7, 6, 5, 4]
  );
  const withNewer = mergeNotchTickerPosts(shown, [post(9, 90), ...shown]);
  assert.deepEqual(
    withNewer.map((item) => item.id),
    [9, 8, 7, 6]
  );
  assert.deepEqual(notchIdsGrow([8, 7, 6], [8, 7, 6, 5, 4]), { prefix: 0 });
  assert.deepEqual(notchIdsGrow([8, 7, 6], [9, 8, 7, 6]), { prefix: 1 });
  assert.equal(notchIdsGrow([8, 7, 6], [8, 7, 5, 6]), undefined);
  assert.deepEqual(
    mergeNotchTickerPosts([], [post(1, 1), post(2, 2)]).map((item) => item.id),
    [2, 1]
  );
  const incoming = [post(9, 90), ...shown, post(5, 50)];
  const once = mergeNotchTickerPosts(shown, incoming);
  assert.deepEqual(
    mergeNotchTickerPosts(once, incoming).map((item) => item.id),
    once.map((item) => item.id)
  );
});

test("retargets the marquee only while the seam is off screen", () => {
  assert.equal(notchCanRetarget(0, 0, 800), true);
  assert.equal(notchCanRetarget(0, 500, 800), true);
  assert.equal(notchCanRetarget(0, 2000, 800), true);
  assert.equal(notchCanRetarget(1200, 2000, 800), true);
  assert.equal(notchCanRetarget(1500, 2000, 800), false);
  assert.equal(notchRetargetOffset(100, 500, 800, 40), 0);
  assert.equal(notchRetargetOffset(100, 2000, 800, 40), 140);
  assert.equal(notchRetargetOffset(1900, 2000, 800, 200), 100);
});
