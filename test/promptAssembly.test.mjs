// Regression tests for prompt shape. Run with `npm test` (builds, then node --test).
// Guards the invariant that bit us with DeepSeek-V3.2 on Bedrock: a `system`
// message placed AFTER the user turn made the model echo the whole prompt.
import test from "node:test";
import assert from "node:assert/strict";
import { assemblePrompt } from "../dist/promptAssembly.js";

const card = {
  name: "Tester",
  system_prompt: "You are Tester.",
  post_history_instructions: "Be terse.",
};

test("reply compose: clean system+user pair, no trailing system message", () => {
  const { messages } = assemblePrompt({ card, platform: "x", sourcePost: "hello" });
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, "system");
  assert.equal(messages[1].role, "user");
  // No system message may follow the user turn.
  const userIdx = messages.findIndex((m) => m.role === "user");
  assert.ok(!messages.slice(userIdx + 1).some((m) => m.role === "system"));
  // post_history_instructions must ride along in the user turn (ST's final steer).
  assert.match(messages[1].content, /Be terse\./);
});

test("standalone compose (no sourcePost): still system+user, correct charLimit", () => {
  const { messages, meta } = assemblePrompt({ card, platform: "instagram" });
  assert.equal(messages.length, 2);
  assert.equal(messages[1].role, "user");
  assert.equal(meta.charLimit, 2200);
});

test("card without post_history_instructions still yields system+user", () => {
  const { messages } = assemblePrompt({
    card: { name: "Bare", system_prompt: "You are Bare." },
    platform: "x",
    sourcePost: "hi",
  });
  assert.equal(messages.length, 2);
  assert.equal(messages[1].role, "user");
});
