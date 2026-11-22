import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeNotchMessage,
  formatNotchTickerItem,
  notchTickerText,
  packNotchMessage,
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
