import type { FastifyInstance } from "fastify";
import type { Note } from "@case404/shared";
import { sendError, teamAuth } from "../app.js";
import { tx } from "../db.js";
import { newId } from "../security.js";
import { type AppContext, getTeam, iso } from "../state.js";

const MAX_NOTES = 200;
const EVIDENCE_REF = /^[A-Za-z0-9_./-]{1,200}$/;

type NoteRow = {
  id: string;
  title: string;
  body: string;
  evidence_refs: string;
  starred: number;
  version: number;
  created_at: string;
  updated_at: string;
  author_member_id: string | null;
  last_editor_member_id: string | null;
};

const noteBodySchema = {
  type: "object",
  properties: {
    title: { type: "string", maxLength: 120 },
    body: { type: "string", maxLength: 5000 },
    evidenceRefs: { type: "array", items: { type: "string" }, maxItems: 12 },
    starred: { type: "boolean" },
    version: { type: "integer" },
  },
} as const;

type NoteBody = { title?: string; body?: string; evidenceRefs?: string[]; starred?: boolean; version?: number };

export function registerNotesRoutes(app: FastifyInstance, ctx: AppContext) {
  const auth = teamAuth(ctx);

  const nicknames = (teamId: string) =>
    new Map((ctx.db.prepare("SELECT id, nickname FROM team_members WHERE team_id = ?").all(teamId) as { id: string; nickname: string }[]).map((m) => [m.id, m.nickname]));

  const toNote = (row: NoteRow, names: Map<string, string>): Note => ({
    id: row.id,
    title: row.title,
    body: row.body,
    evidenceRefs: JSON.parse(row.evidence_refs),
    starred: !!row.starred,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    author: row.author_member_id ? (names.get(row.author_member_id) ?? null) : null,
    lastEditor: row.last_editor_member_id ? (names.get(row.last_editor_member_id) ?? null) : null,
  });

  const getNote = (teamId: string, id: string) => ctx.db.prepare("SELECT * FROM team_notes WHERE team_id = ? AND id = ?").get(teamId, id) as NoteRow | undefined;
  const bumpNotes = (teamId: string) => ctx.db.prepare("UPDATE teams SET notes_rev = notes_rev + 1 WHERE id = ?").run(teamId);
  const cleanRefs = (refs: string[] | undefined) => [...new Set((refs ?? []).filter((r) => EVIDENCE_REF.test(r)))];

  app.get("/api/notes", { preHandler: auth }, async (req) => {
    const names = nicknames(req.team!.id);
    const rows = ctx.db.prepare("SELECT * FROM team_notes WHERE team_id = ? ORDER BY starred DESC, updated_at DESC").all(req.team!.id) as NoteRow[];
    return { notes: rows.map((r) => toNote(r, names)), revision: getTeam(ctx, req.team!.id)!.notes_rev };
  });

  app.post<{ Body: NoteBody }>("/api/notes", { preHandler: auth, schema: { body: noteBodySchema } }, async (req, reply) => {
    const team = req.team!;
    const count = (ctx.db.prepare("SELECT COUNT(*) AS n FROM team_notes WHERE team_id = ?").get(team.id) as { n: number }).n;
    if (count >= MAX_NOTES) return sendError(reply, 409, "too_many_notes", "Your team has reached the note limit. Delete or merge some notes.");
    const body = (req.body.body ?? "").trim();
    const title = (req.body.title ?? "").trim() || body.split("\n")[0].slice(0, 60) || "Untitled note";
    if (!body && !req.body.title) return sendError(reply, 400, "empty_note", "Write something first.");
    const id = newId("note");
    const now = iso(ctx.clock.now());
    tx(ctx.db, () => {
      ctx.db
        .prepare(
          "INSERT INTO team_notes (id, team_id, author_member_id, last_editor_member_id, title, body, evidence_refs, starred, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
        )
        .run(id, team.id, req.member!.id, req.member!.id, title, body, JSON.stringify(cleanRefs(req.body.evidenceRefs)), req.body.starred ? 1 : 0, now, now);
      bumpNotes(team.id);
    });
    return reply.code(201).send(toNote(getNote(team.id, id)!, nicknames(team.id)));
  });

  app.put<{ Params: { id: string }; Body: NoteBody }>("/api/notes/:id", { preHandler: auth, schema: { body: { ...noteBodySchema, required: ["version"] } } }, async (req, reply) => {
    const team = req.team!;
    const current = getNote(team.id, req.params.id);
    if (!current) return sendError(reply, 404, "not_found", "That note no longer exists.");
    const names = nicknames(team.id);
    if (current.version !== req.body.version) {
      return sendError(reply, 409, "version_conflict", "A teammate edited this note. Review their version before saving again.", { current: toNote(current, names) });
    }
    const now = iso(ctx.clock.now());
    tx(ctx.db, () => {
      ctx.db
        .prepare("UPDATE team_notes SET title = ?, body = ?, evidence_refs = ?, starred = ?, version = version + 1, last_editor_member_id = ?, updated_at = ? WHERE id = ? AND version = ?")
        .run(
          (req.body.title ?? current.title).trim() || "Untitled note",
          req.body.body ?? current.body,
          JSON.stringify(req.body.evidenceRefs ? cleanRefs(req.body.evidenceRefs) : JSON.parse(current.evidence_refs)),
          req.body.starred === undefined ? current.starred : req.body.starred ? 1 : 0,
          req.member!.id,
          now,
          current.id,
          current.version,
        );
      bumpNotes(team.id);
    });
    return toNote(getNote(team.id, current.id)!, names);
  });

  app.delete<{ Params: { id: string }; Querystring: { version?: string } }>("/api/notes/:id", { preHandler: auth }, async (req, reply) => {
    const team = req.team!;
    const current = getNote(team.id, req.params.id);
    if (!current) return { ok: true };
    if (req.query.version && Number(req.query.version) !== current.version) {
      return sendError(reply, 409, "version_conflict", "A teammate changed this note. Review it before deleting.", { current: toNote(current, nicknames(team.id)) });
    }
    tx(ctx.db, () => {
      ctx.db.prepare("DELETE FROM team_notes WHERE id = ?").run(current.id);
      bumpNotes(team.id);
    });
    return { ok: true };
  });
}
