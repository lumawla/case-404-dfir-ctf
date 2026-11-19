/** API contract shared by the web client and the API. Contains no answers or secret narrative. */

export type ChallengeId = "EV01" | "EV02" | "EV03" | "EV04" | "EV05" | "EV06" | "EV07" | "EV08";
export type SuspectId = "yasmine" | "lucien" | "karim" | "tara" | "salma";
export type ActNumber = 1 | 2 | 3;
export type TeamCaseStatus = "NOT_STARTED" | "ACTIVE" | "SOLVED" | "WRONG_VERDICT" | "TIME_EXPIRED";
export type ChallengeCategory = "Forensics" | "Crypto" | "Mobile" | "OSINT" | "Misc";
export type Difficulty = "Easy" | "Medium" | "Hard";

export type ClockState = {
  serverNow: string;
  startedAt: string | null;
  deadlineAt: string | null;
  completedAt: string | null;
  status: TeamCaseStatus;
  paused: boolean;
};

export type MemberView = {
  id: string;
  nickname: string;
  role: "captain" | "member";
  ready: boolean;
  connected: boolean;
  isMe: boolean;
};

export type ActivityItem = {
  id: number;
  at: string;
  nickname: string | null;
  kind: "joined" | "started" | "solved" | "act" | "verdict" | "admin" | "expired";
  text: string;
};

export type Announcement = { id: number; at: string; body: string };

export type ScoreBreakdown = {
  flagPoints: number;
  verdictPoints: number;
  /** Naming the accomplice in a correct accusation. */
  bonusPoints: number;
  penalties: number;
  total: number;
};

export type EventView = {
  id: string;
  title: string;
  durationSeconds: number;
  minTeamSize: number;
  maxTeamSize: number;
  paused: boolean;
  leaderboardPublic: boolean;
  revealed: boolean;
  startOpen: boolean;
};

export type TeamState = {
  team: {
    id: string;
    name: string;
    status: TeamCaseStatus;
    startedAt: string | null;
    deadlineAt: string | null;
    completedAt: string | null;
    score: ScoreBreakdown;
  };
  me: { memberId: string; nickname: string; role: "captain" | "member" };
  members: MemberView[];
  event: EventView;
  clock: ClockState;
  solvedIds: ChallengeId[];
  verdict: { attemptsUsed: number; attemptsMax: number };
  activity: ActivityItem[];
  announcements: Announcement[];
  acts: ActsView;
  revisions: { notes: number; solves: number };
};

/** The case opens in acts. A locked act's title and intro are withheld. */
export type ActView = {
  n: ActNumber;
  open: boolean;
  openedAt: string | null;
  title: string | null;
  intro: string | null;
  /** How the act opens, e.g. "Owning both Act I challenges". */
  unlock: string;
};

export type ActsView = { current: ActNumber; list: ActView[] };

/** A challenge on the board. While its act is sealed, title, description and format are null. */
export type ChallengeView = {
  id: ChallengeId;
  act: ActNumber;
  locked: boolean;
  title: string | null;
  category: ChallengeCategory;
  difficulty: Difficulty;
  points: number;
  description: string | null;
  format: string | null;
  solved: boolean;
  solvedAt: string | null;
  solvedBy: string | null;
  /** Teams (across the event) that have solved this challenge. */
  solves: number;
  /** Name of the first team to solve it, if any. */
  firstBlood: string | null;
};

/** One file in the read-only evidence file system. `path` is relative to ~/case404. */
export type FileEntry = { path: string; size: number; modified: string; mime: string };

export type FileListing = { root: string; files: FileEntry[]; /** Changes when new evidence is mounted. */ revision: string };

export type PersonView = {
  id: string;
  name: string;
  alias: string;
  costume: string;
  role: string;
  relationship: string;
  /** Null when there is no photo on file. */
  portrait: string | null;
  portraitAlt?: string;
  portraitNote?: string;
};

export type CaseFile = {
  caseId: string;
  title: string;
  briefing: string[];
  victim: PersonView & { summary: string };
  suspects: PersonView[];
  witnesses: PersonView[];
};

export type TimelineEntry = {
  id: string;
  /** ISO time, used for ordering. */
  at: string;
  label: string;
  text: string;
  /** The challenge that added it, or null for what was known from the start. */
  source: ChallengeId | null;
  /** Shown struck through: a later finding replaced it. */
  struck: boolean;
};

export type Note = {
  id: string;
  title: string;
  body: string;
  evidenceRefs: string[];
  starred: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  author: string | null;
  lastEditor: string | null;
};

export type FlagResultStatus =
  | "correct"
  | "incorrect"
  | "format_error"
  | "already_solved"
  | "time_expired"
  | "not_started"
  | "case_closed"
  | "paused"
  | "locked"
  | "rate_limited";

export type FlagResult = {
  status: FlagResultStatus;
  challengeId: ChallengeId;
  message: string;
  awardedPoints: number;
  totalScore: number;
  firstBlood: boolean;
  /** Set when this solve opened a new act. */
  actOpened?: ActNumber;
  retryAfterSeconds?: number;
};

export type AccusationOptions = {
  /** Accusations open with the final act. */
  open: boolean;
  attemptsUsed: number;
  attemptsMax: number;
  maxFiles: number;
  suspects: { id: SuspectId; name: string; alias: string; portrait: string | null }[];
  motives: { id: string; label: string }[];
  /** Points for naming the accomplice in a correct accusation. */
  accompliceBonus: number;
  previous: { attemptNo: number; suspectId: SuspectId; motiveId: string; accompliceId: SuspectId | null; files: string[]; correct: boolean; at: string }[];
};

export type AccusationResult = {
  status: "correct" | "incorrect" | "final_incorrect";
  message: string;
  penalty: number;
  bonus: number;
  attemptsUsed: number;
  totalScore: number;
};

export type ResultView = {
  status: TeamCaseStatus;
  teamName: string;
  score: ScoreBreakdown;
  elapsedSeconds: number | null;
  solvedIds: ChallengeId[];
  wrongAttempts: number;
  /** Whether the closing accusation named the accomplice. Null until the case is solved. */
  accompliceNamed: boolean | null;
  ending: { title: string; text: string };
  reconstruction: {
    text: string;
    stinger: string;
    answers: { challengeId: ChallengeId; title: string; flag: string }[];
  } | null;
  revealPending: boolean;
};

export type LeaderboardRow = {
  rank: number;
  teamName: string;
  score: number;
  status: TeamCaseStatus;
  solvedCount: number;
  elapsedSeconds: number | null;
  lastScoreAt: string | null;
};

export type PracticeTask = { id: string; title: string; description: string; format: string };

export type PracticeResult = { status: "correct" | "incorrect" | "format_error" | "rate_limited"; message: string };

export type ApiError = { error: string; message: string };
