import { it, expect, vi } from "vitest";
import { StagingClient, StaleAccountError, type StagingConfig } from "./client";
import { emptyWorkspace } from "../../safety";
const config: StagingConfig = {
  environment: "staging",
  syntheticOnly: true,
  apiUrl: "https://synthetic-staging.supabase.co",
  projectRef: "synthetic-staging",
  publishableKey: "sb_publishable_synthetic",
};
// Synthetic unsigned-shaped JWTs for mocked HTTP lifecycle tests, never database authorization.
const token = (sub: string) =>
  `header.${btoa(JSON.stringify({ sub, role: "authenticated" }))}.signature`;
const response = (goalWeight = 160) =>
  new Response(
    JSON.stringify({
      data: { ...emptyWorkspace(), goalWeight },
      revision: 1,
      recordRevisions: {},
    }),
    { status: 200 },
  );
it("is inert until explicitly signed in and never persists sessions", async () => {
  const fetcher = vi.fn();
  const client = new StagingClient(config, fetcher);
  expect(fetcher).not.toHaveBeenCalled();
  expect(client.getCached()).toBeNull();
  await expect(client.load()).rejects.toThrow(/Sign in/);
  expect(fetcher).not.toHaveBeenCalled();
});
it.each([
  { ...config, environment: "production" },
  { ...config, syntheticOnly: false },
  { ...config, apiUrl: "https://production.supabase.co" },
  { ...config, publishableKey: "sb_secret_forbidden" },
  { ...config, apiUrl: "http://synthetic-staging.supabase.co" },
])("rejects unsafe configuration", (cfg) => {
  expect(() => new StagingClient(cfg as StagingConfig)).toThrow();
});
it("sends only caller token; owner context does not enter commands; cache is isolated", async () => {
  const fetcher = vi.fn(
    async (_url: RequestInfo | URL, _options?: RequestInit) => response(),
  );
  const client = new StagingClient(config, fetcher);
  client.setSession({ userId: "a", accessToken: token("a") });
  const loaded = await client.load();
  loaded.data.goalWeight = 999;
  expect(client.getCached()?.data.goalWeight).toBe(160);
  const options = fetcher.mock.calls[0][1] as RequestInit;
  expect(options.headers).toMatchObject({
    Authorization: "Bearer " + token("a"),
  });
  expect(options.cache).toBe("no-store");
  expect(options.credentials).toBe("omit");
  client.setSession({ userId: "b", accessToken: token("b") });
  expect(client.getCached()).toBeNull();
  await client.load();
  expect(fetcher.mock.calls[1][1]?.headers).toMatchObject({
    Authorization: "Bearer " + token("b"),
  });
});
it("aborts and discards an account A response arriving after switching to B", async () => {
  let resolve: (r: Response) => void = () => {};
  let signal: AbortSignal | null | undefined;
  const client = new StagingClient(
    config,
    vi.fn((_url, options) => {
      signal = options?.signal;
      return new Promise<Response>((r) => (resolve = r));
    }),
  );
  client.setSession({ userId: "a", accessToken: token("a") });
  const old = client.load();
  client.setSession({ userId: "b", accessToken: token("b") });
  expect(signal?.aborted).toBe(true);
  resolve(response());
  await expect(old).rejects.toBeInstanceOf(StaleAccountError);
  expect(client.getCached()).toBeNull();
  expect(client.accountId).toBe("b");
});
it("clears caches on expired-session responses and keeps revision conflict explicit", async () => {
  let status = 200;
  const client = new StagingClient(config, async () =>
    status === 200
      ? response()
      : new Response(
          JSON.stringify({ code: status === 409 ? "40001" : "denied" }),
          { status },
        ),
  );
  client.setSession({ userId: "a", accessToken: token("a") });
  await client.load();
  status = 409;
  await expect(client.load()).rejects.toThrow(/conflict/);
  expect(client.accountId).toBe("a");
  status = 401;
  await expect(client.load()).rejects.toThrow();
  expect(client.accountId).toBeNull();
  expect(client.getCached()).toBeNull();
});
it("does not retain old data or token after sign-out even if revocation fails", async () => {
  let status = 200;
  const client = new StagingClient(config, async () =>
    status === 200 ? response() : new Response(JSON.stringify({}), { status }),
  );
  client.setSession({ userId: "a", accessToken: token("a") });
  await client.load();
  status = 500;
  await expect(client.signOut()).rejects.toThrow();
  expect(client.accountId).toBeNull();
  expect(client.getCached()).toBeNull();
  await expect(client.load()).rejects.toThrow(/Sign in/);
});
it("discards a late sign-in response when another sign-in has started", async () => {
  const pending: ((r: Response) => void)[] = [];
  const client = new StagingClient(
    config,
    () => new Promise((r) => pending.push(r)),
  );
  const a = client.signIn("a@example.invalid", "synthetic"),
    b = client.signIn("b@example.invalid", "synthetic");
  pending[1](
    new Response(
      JSON.stringify({ access_token: token("b"), user: { id: "b" } }),
    ),
  );
  await b;
  pending[0](
    new Response(
      JSON.stringify({ access_token: token("a"), user: { id: "a" } }),
    ),
  );
  await expect(a).rejects.toBeInstanceOf(StaleAccountError);
  expect(client.accountId).toBe("b");
});
it("accepts successful no-content Auth logout and clears the cache", async () => {
  const client = new StagingClient(config, async (url) =>
    String(url).includes("/logout")
      ? new Response(null, { status: 204 })
      : response(),
  );
  client.setSession({ userId: "a", accessToken: token("a") });
  await client.load();
  await expect(client.signOut()).resolves.toBeUndefined();
  expect(client.getCached()).toBeNull();
  expect(client.accountId).toBeNull();
});
it("copies configuration so callers cannot swap in a privileged key later", async () => {
  const mutable = { ...config };
  const fetcher = vi.fn(
    async (_url: RequestInfo | URL, _options?: RequestInit) => response(),
  );
  const client = new StagingClient(mutable, fetcher);
  mutable.publishableKey = "sb_secret_forbidden";
  client.setSession({ userId: "a", accessToken: token("a") });
  await client.load();
  expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({
    apikey: config.publishableKey,
  });
});
it("rejects legacy service-role JWT keys as browser configuration", () => {
  expect(
    () =>
      new StagingClient({ ...config, publishableKey: "opaque-unknown-key" }),
  ).toThrow(/format/);
  const claims = btoa(JSON.stringify({ role: "service_role" }));
  expect(
    () =>
      new StagingClient({
        ...config,
        publishableKey: `header.${claims}.signature`,
      }),
  ).toThrow(/privileged/);
});

it("refuses to bind account B to account A's bearer token and erases the old cache", async () => {
  const fetcher = vi.fn(async () => response());
  const client = new StagingClient(config, fetcher);
  client.setSession({ userId: "a", accessToken: token("a") });
  await client.load();
  expect(() =>
    client.setSession({ userId: "b", accessToken: token("a") }),
  ).toThrow(/identity/);
  expect(client.getCached()).toBeNull();
  expect(client.accountId).toBeNull();
  await expect(client.load()).rejects.toThrow(/Sign in/);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
