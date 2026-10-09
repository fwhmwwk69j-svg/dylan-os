/** Drop original messages, causes, query details and assertion payloads from test reports. */
export async function sanitized(label, action) {
  try {
    return await action();
  } catch (error) {
    const code =
      typeof error?.code === "string" && /^[A-Z0-9]{5}$/.test(error.code)
        ? ` [${error.code}]`
        : "";
    throw new Error(
      `${label} failed${code}; credentials and response details withheld.`,
    );
  }
}
export function safeTest(register) {
  return (name, options, action) => {
    if (typeof options === "function") {
      action = options;
      options = {};
    }
    return register(name, options, () => sanitized(name, action));
  };
}
/** Attempt every resource even after a failure; never log original transport errors. */
export async function cleanupSynthetic({
  objects,
  accounts,
  removeObjects,
  removeAccount,
  verifyAccount,
  close,
}) {
  const failures = [];
  try {
    if (objects.length)
      try {
        await removeObjects(objects);
      } catch {
        failures.push("storage cleanup");
      }
    for (const id of accounts) {
      try {
        await removeAccount(id);
        await verifyAccount(id);
      } catch {
        failures.push("synthetic account cleanup");
      }
    }
  } finally {
    try {
      await close();
    } catch {
      failures.push("database close");
    }
  }
  if (failures.length)
    throw new Error(
      `Synthetic cleanup incomplete: ${failures.join(", ")}. Inspect only this run's generated test resources.`,
    );
}

export function assertPublishableKey(key) {
  if (typeof key !== "string" || !key)
    throw new Error("Staging publishable configuration required.");
  if (key.startsWith("sb_publishable_")) return;
  try {
    if (key.split(".").length !== 3) throw new Error();
    const claims = JSON.parse(
      Buffer.from(key.split(".")[1], "base64url").toString(),
    );
    if (claims.role !== "anon") throw new Error();
  } catch {
    throw new Error("Privileged or malformed public-client key rejected.");
  }
}
