import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitized, cleanupSynthetic, safeTest } from "./staging-safety.mjs";
test("redaction excludes error messages assertion payloads and causes", async () => {
  const sensitive = "never-print-this-secret";
  for (const original of [
    new Error(sensitive),
    Object.assign(new Error(sensitive), {
      code: "42501",
      detail: sensitive,
      cause: new Error(sensitive),
    }),
    new assert.AssertionError({
      actual: { token: sensitive },
      expected: { password: sensitive },
    }),
  ]) {
    try {
      await sanitized("Synthetic check", async () => {
        throw original;
      });
      assert.fail("must fail");
    } catch (error) {
      assert(!JSON.stringify(error).includes(sensitive));
      assert(!error.stack.includes(sensitive));
      assert.equal(error.cause, undefined);
      assert.equal(error.actual, undefined);
      assert.match(error.message, /withheld/);
    }
  }
});
test("SQLSTATE allowlist never prints arbitrary credential-bearing codes", async () => {
  await assert.rejects(
    sanitized("Synthetic", async () => {
      throw { code: "secret-url-password" };
    }),
    (error) => !error.message.includes("secret-url-password"),
  );
});
test("cleanup failures attempt all resources verify successes and close", async () => {
  const calls = [];
  await assert.rejects(
    cleanupSynthetic({
      objects: ["synthetic"],
      accounts: ["a", "b"],
      removeObjects: async () => {
        calls.push("objects");
        throw Error("secret");
      },
      removeAccount: async (id) => {
        calls.push(id);
        if (id === "a") throw Error("secret");
      },
      verifyAccount: async (id) => calls.push("verify:" + id),
      close: async () => calls.push("close"),
    }),
    /incomplete/,
  );
  assert.deepEqual(calls, ["objects", "a", "b", "verify:b", "close"]);
});
test("cleanup verification failure is a test failure even after successful deletion", async () => {
  await assert.rejects(
    cleanupSynthetic({
      objects: [],
      accounts: ["a"],
      removeAccount: async () => {},
      verifyAccount: async () => {
        throw Error("orphan");
      },
      close: async () => {},
    }),
    /incomplete/,
  );
});
test("database close failure is reported without raw details", async () => {
  await assert.rejects(
    cleanupSynthetic({
      objects: [],
      accounts: [],
      removeObjects: async () => {},
      removeAccount: async () => {},
      verifyAccount: async () => {},
      close: async () => {
        throw Error("secret-uri");
      },
    }),
    (error) =>
      !error.message.includes("secret-uri") &&
      error.message.includes("database close"),
  );
});
test("safe test registration preserves names skip options and failure semantics", async () => {
  let captured;
  const register = safeTest((name, options, fn) => {
    captured = { name, options, fn };
  });
  register("original check", { skip: "missing configuration" }, async () => {
    throw Error("secret");
  });
  assert.equal(captured.name, "original check");
  assert.equal(captured.options.skip, "missing configuration");
  await assert.rejects(captured.fn(), /details withheld/);
});
test("publishable-key guard rejects privileged and malformed credentials", async () => {
  const { assertPublishableKey } = await import("./staging-safety.mjs");
  const legacy = (role) =>
    "header." +
    Buffer.from(JSON.stringify({ role })).toString("base64url") +
    ".signature";
  for (const key of [
    "sb_secret_synthetic",
    legacy("service_role"),
    "malformed",
    "",
  ])
    assert.throws(() => assertPublishableKey(key));
});
test("publishable-key guard accepts browser-safe key shapes without claiming signature verification", async () => {
  const { assertPublishableKey } = await import("./staging-safety.mjs");
  assert.doesNotThrow(() => assertPublishableKey("sb_publishable_synthetic"));
  assert.doesNotThrow(() =>
    assertPublishableKey(
      "header." +
        Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url") +
        ".signature",
    ),
  );
});
