import type { FileListing } from "@case404/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../api";
import type { TermEntry, TermSession } from "./Terminal";
import { type FileIO, type Out, Shell } from "./shell";
import { Vfs } from "./vfs";

/** Where a file tree's bytes come from: the case evidence or the practice folder. */
export type FileUrls = { raw: (path: string, download?: boolean) => string; text?: (path: string) => string };

/** Fetches file bytes on demand and keeps them for the session. */
export function browserIO(urls: FileUrls): FileIO {
  const bytes = new Map<string, Promise<Uint8Array>>();
  const objectUrls = new Map<string, string>();
  const get = async (url: string, path: string) => {
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) throw new ApiError(res.status, "file_error", `Couldn't read ${path} (${res.status}).`);
    return res;
  };
  const io: FileIO = {
    read(node) {
      if (node.data) return Promise.resolve(node.data);
      const key = node.casePath!;
      if (!bytes.has(key)) {
        const p = get(urls.raw(key), key).then(async (r) => new Uint8Array(await r.arrayBuffer()));
        p.catch(() => bytes.delete(key));
        bytes.set(key, p);
      }
      return bytes.get(key)!;
    },
    async pdfText(node) {
      if (!urls.text) throw new ApiError(415, "no_text_layer", "Not a PDF document.");
      return (await get(urls.text(node.casePath!), node.casePath!)).text();
    },
    async objectUrl(node) {
      // PDFs open through the server so the browser's PDF viewer works; images use blob URLs.
      if (node.casePath && node.mime === "application/pdf") return urls.raw(node.casePath);
      const key = node.abs;
      if (!objectUrls.has(key)) objectUrls.set(key, URL.createObjectURL(new Blob([(await io.read(node)).slice()], { type: node.mime })));
      return objectUrls.get(key)!;
    },
    async download(node) {
      const a = document.createElement("a");
      a.href = node.casePath ? urls.raw(node.casePath, true) : await io.objectUrl(node);
      a.download = node.name;
      document.body.append(a);
      a.click();
      a.remove();
    },
    openInNewTab(url) {
      window.open(url, "_blank", "noopener");
    },
  };
  return io;
}

let noticeId = 1_000_000;

/**
 * One terminal over a file tree. The shell is created once; when the listing grows (a new act), the new
 * files are mounted in place, so the working directory, history and /tmp survive. History and the
 * working directory are kept per team in localStorage.
 */
export function useTermSession(opts: {
  listing: FileListing | null;
  urls: FileUrls;
  storageKey: string | null;
  motd: Out[];
  onMount?: (added: string[]) => Out[];
  showImage: TermSession["showImage"];
}): TermSession {
  const { listing, storageKey, motd, onMount, showImage } = opts;
  const io = useRef<FileIO>(browserIO(opts.urls));
  const [shell, setShell] = useState<Shell | null>(null);
  const [entries, setEntriesState] = useState<TermEntry[]>([{ id: 0, outs: motd }]);
  const onMountRef = useRef(onMount);
  onMountRef.current = onMount;

  useEffect(() => {
    if (!listing || !storageKey) return;
    if (shell) {
      const added = shell.vfs.mount(listing);
      const outs = added.length ? onMountRef.current?.(added) : undefined;
      if (outs?.length) setEntriesState((prev) => [...prev, { id: noticeId++, outs }].slice(-400));
      return;
    }
    const sh = new Shell(new Vfs(listing), io.current);
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null") as { history: string[]; cwd: string } | null;
      if (saved) {
        sh.history.push(...saved.history.slice(-200));
        if (sh.cd(saved.cwd)) sh.cd(listing.root);
      } else sh.cd(listing.root);
    } catch {
      sh.cd(listing.root);
    }
    setShell(sh);
    // The shell is created once per tree (not on shell changes); later listings only mount new files.
  }, [listing, storageKey]);

  const setEntries = useCallback(
    (fn: (prev: TermEntry[]) => TermEntry[]) => {
      setEntriesState((prev) => fn(prev).slice(-400));
      if (shell && storageKey) {
        try {
          localStorage.setItem(storageKey, JSON.stringify({ history: shell.history.slice(-200), cwd: shell.cwd }));
        } catch {
          /* history stays in memory only */
        }
      }
    },
    [shell, storageKey],
  );

  return { shell, entries, setEntries, showImage };
}
