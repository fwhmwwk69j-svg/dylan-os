import type { State } from "../../data";
import { validateWorkspace } from "../../safety";
import type { Collection } from "../../domain/collections";
export type StagingConfig = {
  environment: "staging";
  syntheticOnly: true;
  apiUrl: string;
  projectRef: string;
  publishableKey: string;
};
export type StagingSession = { userId: string; accessToken: string };
export type CloudRead = {
  data: State;
  revision: number;
  recordRevisions: Record<Collection, Record<string, number>>;
};
export type StagingCommand =
  | {
      action: "upsert";
      collection: Collection;
      record: Record<string, unknown>;
      expectedRevision: number;
      expectedRecordRevision: number;
    }
  | {
      action: "delete";
      collection: Collection;
      id: string;
      expectedRevision: number;
      expectedRecordRevision: number;
    }
  | {
      action: "preferences";
      preferences: NonNullable<State["preferences"]>;
      expectedRevision: number;
    }
  | {
      action: "goals";
      goals: {
        goalWeight: number | null;
        fitnessGoals?: State["fitnessGoals"];
      };
      expectedRevision: number;
    }
  | {
      action: "restore";
      snapshotId: string;
      confirmation: "RESTORE MY STAGING SNAPSHOT";
      expectedRevision: number;
    };
export class StaleAccountError extends Error {
  constructor() {
    super("The account changed. This response was discarded.");
  }
}
function validateConfig(config: StagingConfig) {
  const url = new URL(config.apiUrl);
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);
  if (
    config.environment !== "staging" ||
    config.syntheticOnly !== true ||
    url.pathname !== "/" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (!local &&
      (url.protocol !== "https:" ||
        url.hostname !== `${config.projectRef}.supabase.co` ||
        !config.projectRef ||
        url.port))
  )
    throw Error("Only explicit isolated staging configuration is allowed.");
  if (!["http:", "https:"].includes(url.protocol))
    throw Error("Unsupported staging protocol.");
  if (!config.publishableKey || config.publishableKey.startsWith("sb_secret_"))
    throw Error(
      "A publishable key is required; privileged keys are forbidden.",
    );
  if (
    !config.publishableKey.startsWith("sb_publishable_") &&
    config.publishableKey.split(".").length !== 3
  )
    throw Error("Unrecognized publishable key format.");
  if (config.publishableKey.split(".").length === 3) {
    try {
      const claims = JSON.parse(
        atob(
          config.publishableKey
            .split(".")[1]
            .replace(/-/g, "+")
            .replace(/_/g, "/"),
        ),
      );
      if (claims.role !== "anon") throw Error("Privileged key");
    } catch {
      throw Error(
        "Browser configuration cannot contain a privileged or malformed key.",
      );
    }
  }
  return url.origin;
}
/** Opt-in staging test harness only. Never imported by App or used as its repository. */
export class StagingClient {
  private session: StagingSession | null = null;
  private epoch = 0;
  private pending = new Set<AbortController>();
  private cache: CloudRead | null = null;
  private readonly origin: string;
  constructor(
    private readonly config: StagingConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.origin = validateConfig(config);
    this.config = Object.freeze({ ...config });
  }
  private replaceSession(session: StagingSession | null) {
    this.epoch++;
    for (const request of this.pending) request.abort();
    this.pending.clear();
    this.cache = null;
    this.session = null;
    if (session) {
      // Consistency only: the server verifies the signature and grants authorization.
      // Prevent pairing an account-B cache identity with an account-A bearer token.
      try {
        const part = session.accessToken.split(".")[1];
        const claims = JSON.parse(
          atob(part.replace(/-/g, "+").replace(/_/g, "/")),
        );
        if (
          !session.userId ||
          claims.sub !== session.userId ||
          claims.role !== "authenticated"
        )
          throw Error("Mismatch");
      } catch {
        throw Error("Auth session identity does not match its bearer token.");
      }
      this.session = { ...session };
    }
  }
  /** Input must come from Auth. No owner is ever sent to a command or used for server authorization. */
  setSession(session: StagingSession | null) {
    this.replaceSession(session);
  }
  getCached(): CloudRead | null {
    return this.cache ? structuredClone(this.cache) : null;
  }
  get accountId() {
    return this.session?.userId ?? null;
  }
  private async request(
    path: string,
    options: RequestInit,
    token?: string,
    generation = this.epoch,
  ) {
    const abort = new AbortController();
    this.pending.add(abort);
    try {
      const response = await this.fetcher(this.origin + path, {
        ...options,
        signal: abort.signal,
        cache: "no-store",
        credentials: "omit",
        headers: {
          apikey: this.config.publishableKey,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          "Content-Type": "application/json",
        },
      });
      const body: unknown =
        response.status === 204 ? null : await response.json();
      if (generation !== this.epoch) throw new StaleAccountError();
      if (!response.ok) {
        if (response.status === 401 || response.status === 403)
          this.replaceSession(null);
        const code =
          typeof body === "object" && body !== null && "code" in body
            ? String(body.code)
            : "";
        throw Error(
          response.status === 409 || code === "40001" || code === "PT409"
            ? "Cloud revision conflict. Reload before editing."
            : `Staging request failed (${response.status}).`,
        );
      }
      return body;
    } catch (error) {
      if (generation !== this.epoch) throw new StaleAccountError();
      throw error;
    } finally {
      this.pending.delete(abort);
    }
  }
  async signIn(email: string, password: string) {
    this.replaceSession(null);
    const generation = this.epoch;
    const body = (await this.request(
      "/auth/v1/token?grant_type=password",
      { method: "POST", body: JSON.stringify({ email, password }) },
      undefined,
      generation,
    )) as { access_token?: string; user?: { id?: string } };
    if (!body.access_token || !body.user?.id)
      throw Error("Auth returned an invalid session.");
    this.replaceSession({
      accessToken: body.access_token,
      userId: body.user.id,
    });
  }
  async signOut() {
    const token = this.session?.accessToken;
    this.replaceSession(null);
    if (token)
      await this.request(
        "/auth/v1/logout?scope=global",
        { method: "POST" },
        token,
      );
  }
  private async rpc(name: string, body: unknown = {}) {
    const session = this.session;
    if (!session)
      throw Error("Sign in to an approved synthetic staging account first.");
    return this.request(
      `/rest/v1/rpc/${name}`,
      { method: "POST", body: JSON.stringify(body) },
      session.accessToken,
    );
  }
  private readResponse(body: unknown): CloudRead {
    const result = body as CloudRead;
    if (
      !result ||
      !Number.isSafeInteger(result.revision) ||
      result.revision < 0 ||
      !result.recordRevisions ||
      typeof result.recordRevisions !== "object"
    )
      throw Error("Invalid cloud revision response.");
    return { ...result, data: validateWorkspace(result.data) };
  }
  async load() {
    const epoch = this.epoch;
    const result = this.readResponse(await this.rpc("dylan_read"));
    if (epoch !== this.epoch) throw new StaleAccountError();
    this.cache = structuredClone(result);
    return structuredClone(result);
  }
  async command(command: StagingCommand) {
    const epoch = this.epoch;
    const result = this.readResponse(
      await this.rpc("dylan_command", { command }),
    );
    if (epoch !== this.epoch) throw new StaleAccountError();
    this.cache = structuredClone(result);
    return structuredClone(result);
  }
  async exportWorkspace() {
    const epoch = this.epoch;
    const result = validateWorkspace(await this.rpc("dylan_export"));
    if (epoch !== this.epoch) throw new StaleAccountError();
    return result;
  }
  async snapshots() {
    const epoch = this.epoch;
    const result = await this.request(
      "/rest/v1/workspace_snapshots?select=id,revision,reason,created_at&order=created_at.desc",
      { method: "GET" },
      this.requireToken(),
    );
    if (epoch !== this.epoch) throw new StaleAccountError();
    return result;
  }
  private requireToken() {
    if (!this.session) throw Error("Sign in first.");
    return this.session.accessToken;
  }
}
