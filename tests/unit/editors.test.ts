// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Note } from "@case404/shared";
import { api, ApiError, type AdminEventConfig } from "../../apps/web/src/api";
import { NoteEditor } from "../../apps/web/src/routes/case/NotesPanel";
import { EventSettings } from "../../apps/web/src/routes/Admin";

vi.mock("../../apps/web/src/api", async original => ({ ...await original<typeof import("../../apps/web/src/api")>(), api: { updateNote: vi.fn(), admin: { updateEvent: vi.fn() } } }));
const note = { id: "n", title: "Title", body: "Original", version: 1 } as Note;
let host: HTMLDivElement, root: Root;
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.clearAllMocks(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function click(text: string) { const el = [...host.querySelectorAll("button")].find(b => b.textContent === text)!; await act(async () => el.click()); }
async function input(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); });
}
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { resolve, promise }; }
async function mountEditor() {
  const close = vi.fn(), saved = vi.fn();
  await act(async () => root.render(createElement(NoteEditor, { note, onClose: close, onSaved: saved })));
  return { close, saved };
}
it("flushes immediately on Done and closes only after the save completes", async () => {
  const pending = deferred<Note>(); vi.mocked(api.updateNote).mockReturnValue(pending.promise);
  const { close } = await mountEditor();
  await input(host.querySelector("textarea")!, "Fast edit"); await click("Done");
  expect(api.updateNote).toHaveBeenCalledWith("n", { title: "Title", body: "Fast edit", version: 1 }); expect(close).not.toHaveBeenCalled();
  await act(async () => pending.resolve({ ...note, body: "Fast edit", version: 2 })); expect(close).toHaveBeenCalledTimes(1);
});
it("serializes edits made while a save is in flight with the returned version", async () => {
  const pending = deferred<Note>(); vi.mocked(api.updateNote).mockReturnValueOnce(pending.promise).mockImplementation(async (_, draft) => ({ ...note, ...draft, version: draft.version + 1 }));
  await mountEditor();
  await input(host.querySelector("textarea")!, "First"); await act(async () => { await vi.advanceTimersByTimeAsync(900); });
  await input(host.querySelector("textarea")!, "Second"); await act(async () => { await vi.advanceTimersByTimeAsync(900); });
  expect(api.updateNote).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve({ ...note, body: "First", version: 2 }));
  expect(api.updateNote).toHaveBeenLastCalledWith("n", { title: "Title", body: "Second", version: 2 });
  expect(host.textContent).toContain("Saved");
});
it("retains failed edits, reports the error and allows retry before closing", async () => {
  vi.mocked(api.updateNote).mockRejectedValueOnce(new ApiError(503, "unavailable", "Save unavailable")).mockResolvedValueOnce({ ...note, body: "Keep me", version: 2 });
  const { close } = await mountEditor(); await input(host.querySelector("textarea")!, "Keep me"); await click("Done");
  expect(close).not.toHaveBeenCalled(); expect(host.querySelector("textarea")!.value).toBe("Keep me"); expect(host.textContent).toContain("Save unavailable");
  await click("Retry save"); await click("Done"); expect(close).toHaveBeenCalledTimes(1);
});
it("requires explicit conflict resolution and uses the teammate's latest version", async () => {
  const theirs = { ...note, body: "Teammate", version: 2 };
  vi.mocked(api.updateNote).mockRejectedValueOnce(new ApiError(409, "version_conflict", "Conflict", { current: theirs })).mockResolvedValueOnce({ ...note, body: "Mine", version: 3 });
  const { close } = await mountEditor(); await input(host.querySelector("textarea")!, "Mine"); await click("Done");
  expect(close).not.toHaveBeenCalled(); expect(host.textContent).toContain("Teammate");
  await click("Mine"); expect(api.updateNote).toHaveBeenLastCalledWith("n", { title: "Title", body: "Mine", version: 2 });
});
it("keeps unsaved organizer edits across polls and sends only edited fields", async () => {
  const event = { title: "Event", durationSeconds: 4500, minTeamSize: 2, maxTeamSize: 3, registrationOpen: true, startOpen: false, revealAt: null } as AdminEventConfig;
  const render = (e: AdminEventConfig) => root.render(createElement(EventSettings, { event: e, onSaved: vi.fn() }));
  await act(async () => render(event)); await input(host.querySelector("input")!, "My draft");
  await act(async () => render({ ...event, startOpen: true, durationSeconds: 3600 }));
  expect(host.querySelector("input")!.value).toBe("My draft");
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(api.admin.updateEvent).toHaveBeenCalledWith({ title: "My draft" });
});
