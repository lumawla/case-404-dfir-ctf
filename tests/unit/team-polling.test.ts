// @vitest-environment jsdom
import { StrictMode, act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamState } from "@case404/shared";
import { api, ApiError } from "../../apps/web/src/api";
import { SettingsProvider, useChime, useSettings } from "../../apps/web/src/state/settings";
import { TeamProvider, useTeam } from "../../apps/web/src/state/team";
import { ToastProvider } from "../../apps/web/src/state/toasts";

vi.mock("../../apps/web/src/api", async (original) => ({
  ...await original<typeof import("../../apps/web/src/api")>(),
  api: { teamState: vi.fn() },
}));

const snapshot = (nickname = "Ana"): TeamState => ({
  clock: { serverNow: new Date().toISOString() },
  me: { nickname }, activity: [], announcements: [],
} as unknown as TeamState);
const unauthorized = () => new ApiError(401, "unauthorized", "Sign in again");
const teamState = vi.mocked(api.teamState);
let team: ReturnType<typeof useTeam>;
let settings: ReturnType<typeof useSettings>;
let chime: ReturnType<typeof useChime>;
let root: Root;
let host: HTMLDivElement;
let visibility: DocumentVisibilityState;

function Probe() {
  team = useTeam();
  settings = useSettings();
  chime = useChime();
  return null;
}
function tree() {
  return createElement(StrictMode, null,
    createElement(SettingsProvider, null,
      createElement(ToastProvider, null,
        createElement(TeamProvider, null, createElement(Probe)))));
}
async function mount() { await act(async () => root.render(tree())); }
async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
async function visible(value: DocumentVisibilityState) {
  await act(async () => {
    visibility = value;
    document.dispatchEvent(new Event("visibilitychange"));
  });
}
function deferred() {
  let resolve!: (value: TeamState) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<TeamState>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  sessionStorage.clear();
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  teamState.mockReset().mockImplementation(async () => snapshot());
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("team polling", () => {
  it("checks once in StrictMode and polls every four seconds despite rerenders or settings changes", async () => {
    await mount();
    expect(teamState).toHaveBeenCalledTimes(1);
    expect(team.loading).toBe(false);
    const firstChime = chime;
    const firstRefresh = team.refresh;
    await act(async () => {
      settings.update({ textScale: "lg" });
      team.rememberCode("TEST-CODE");
      root.render(tree());
    });
    expect(chime).toBe(firstChime);
    await advance(2000);
    await act(async () => settings.update({ sound: true }));
    expect(chime).not.toBe(firstChime);
    expect(team.refresh).toBe(firstRefresh);
    await advance(1999);
    expect(teamState).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(teamState).toHaveBeenCalledTimes(2);
    await advance(12000);
    expect(teamState).toHaveBeenCalledTimes(5);
  });

  it("uses fifteen seconds when hidden and resets one timer on visibility changes", async () => {
    await mount();
    await visible("hidden");
    await advance(14999);
    expect(teamState).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(teamState).toHaveBeenCalledTimes(2);
    await advance(15000);
    expect(teamState).toHaveBeenCalledTimes(3);
    await visible("visible");
    await advance(3999);
    expect(teamState).toHaveBeenCalledTimes(3);
    await advance(1);
    expect(teamState).toHaveBeenCalledTimes(4);
  });

  it.each(["initial", "authenticated"])("stops after an %s 401 until a team is joined", async (phase) => {
    if (phase === "initial") teamState.mockRejectedValueOnce(unauthorized());
    await mount();
    if (phase === "authenticated") {
      teamState.mockRejectedValueOnce(unauthorized());
      await advance(4000);
    }
    const calls = teamState.mock.calls.length;
    expect(team.state).toBeNull();
    expect(team.error?.status).toBe(401);
    expect(team.loading).toBe(false);
    await act(async () => settings.update({ sound: true }));
    await visible("hidden");
    await visible("visible");
    await advance(60000);
    expect(teamState).toHaveBeenCalledTimes(calls);
    await act(async () => team.apply(snapshot("Ben")));
    expect(team.error).toBeNull();
    await advance(3999);
    expect(teamState).toHaveBeenCalledTimes(calls);
    await advance(1);
    expect(teamState).toHaveBeenCalledTimes(calls + 1);
    await advance(8000);
    expect(teamState).toHaveBeenCalledTimes(calls + 3);
  });

  it("coalesces manual refreshes and visibility ticks during a slow request", async () => {
    await mount();
    const slow = deferred();
    teamState.mockReturnValueOnce(slow.promise);
    await advance(4000);
    await act(async () => {
      const one = team.refresh();
      expect(team.refresh()).toBe(one);
    });
    await visible("hidden");
    await visible("visible");
    await advance(12000);
    expect(teamState).toHaveBeenCalledTimes(2);
    await act(async () => slow.resolve(snapshot()));
    await advance(3999);
    expect(teamState).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(teamState).toHaveBeenCalledTimes(3);
    await advance(8000);
    expect(teamState).toHaveBeenCalledTimes(5);
  });

  it.each(["401", "success"])("ignores an old session's late %s after joining", async (result) => {
    const slow = deferred();
    teamState.mockReturnValueOnce(slow.promise);
    await mount();
    await act(async () => team.apply(snapshot("Ben")));
    await advance(4000);
    expect(teamState).toHaveBeenCalledTimes(1);
    await act(async () => {
      if (result === "401") slow.reject(unauthorized());
      else slow.resolve(snapshot("Old session"));
    });
    expect(team.state?.me.nickname).toBe("Ben");
    expect(team.error).toBeNull();
    await advance(4000);
    expect(teamState).toHaveBeenCalledTimes(2);
  });

  it("clears timers and ignores a late success after logout", async () => {
    await mount();
    const slow = deferred();
    teamState.mockReturnValueOnce(slow.promise);
    await advance(4000);
    await act(async () => team.clear());
    await act(async () => slow.resolve(snapshot()));
    await visible("hidden");
    await visible("visible");
    await advance(60000);
    expect(team.state).toBeNull();
    expect(teamState).toHaveBeenCalledTimes(2);
    await act(async () => team.apply(snapshot()));
    await advance(8000);
    expect(teamState).toHaveBeenCalledTimes(4);
  });

  it("retries transient errors at the normal cadence and removes timers on unmount", async () => {
    await mount();
    teamState.mockRejectedValueOnce(new ApiError(503, "unavailable", "Try later"));
    await advance(4000);
    expect(team.error?.status).toBe(503);
    await advance(4000);
    expect(team.error).toBeNull();
    const slow = deferred();
    teamState.mockReturnValueOnce(slow.promise);
    await advance(4000);
    await act(async () => root.unmount());
    root = createRoot(host);
    await act(async () => slow.resolve(snapshot()));
    await visible("visible");
    await advance(60000);
    expect(teamState).toHaveBeenCalledTimes(4);
  });
});
