export interface FileMeta {
  path: string;
  size: number;
  mediaType: string;
  updatedAt: string;
}

export interface NewsRun {
  status: "running" | "done" | "error";
  workflowId: string;
  step?: string;
  path?: string;
  error?: string;
  messageId?: string; // id of the single chat message updated live for this run
  thinking?: string; // accumulated progress/thinking shown in the reasoning part
  say?: string; // current spoken line (message text) while the run is in progress
}

export interface WorkspaceState {
  files: FileMeta[];
  newsRun?: NewsRun;
}

export interface StoredFile {
  content: ArrayBuffer;
  mediaType: string;
}

// Async filesystem contract used by tools. Backed either directly by
// WorkspaceFS or, in the shared-artifact setup, by a DO-to-DO RPC adapter
// (see `agent.ts`). `delete` returns whether the file existed.
export interface AsyncFS {
  list(): Promise<FileMeta[]>;
  get(path: string): Promise<StoredFile | null>;
  put(path: string, content: Uint8Array, mediaType: string): Promise<void>;
  delete(path: string): Promise<boolean>;
}

const TEXT_MEDIA_TYPES: Record<string, string> = {
  md: "text/markdown",
  txt: "text/plain",
  json: "application/json",
  html: "text/html",
  css: "text/css",
  csv: "text/csv",
  js: "text/javascript",
  ts: "text/typescript"
};

export function guessMediaType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return TEXT_MEDIA_TYPES[ext] ?? "text/plain";
}

// Reject absolute paths and traversal; collapse to a clean relative path
export function normalizePath(raw: string): string | null {
  const parts = raw
    .replace(/\\/g, "/")
    .split("/")
    .filter((p) => p !== "" && p !== ".");
  if (parts.length === 0 || parts.some((p) => p === "..")) return null;
  return parts.join("/");
}

// A flat virtual filesystem backed by the agent's embedded SQLite.
// `onChange` fires after every mutation so the agent can sync UI state.
export class WorkspaceFS {
  constructor(
    private readonly sql: SqlStorage,
    private readonly onChange: (files: FileMeta[]) => void
  ) {}

  init() {
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS files (
        path TEXT PRIMARY KEY,
        content BLOB NOT NULL,
        media_type TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`
    );
    this.onChange(this.list());
  }

  list(): FileMeta[] {
    const rows = this.sql
      .exec<{
        path: string;
        size: number;
        media_type: string;
        updated_at: string;
      }>(
        `SELECT path, length(content) AS size, media_type, updated_at
         FROM files ORDER BY path`
      )
      .toArray();
    return rows.map((r) => ({
      path: r.path,
      size: r.size,
      mediaType: r.media_type,
      updatedAt: r.updated_at
    }));
  }

  get(path: string): StoredFile | null {
    const rows = this.sql
      .exec<{ content: ArrayBuffer; media_type: string }>(
        `SELECT content, media_type FROM files WHERE path = ?`,
        path
      )
      .toArray();
    const row = rows[0];
    return row ? { content: row.content, mediaType: row.media_type } : null;
  }

  put(path: string, content: Uint8Array, mediaType: string) {
    // Normalize to a tight ArrayBuffer: a subarray view would otherwise
    // persist the whole backing buffer (e.g. after RPC structured-clone).
    const buffer =
      content.byteOffset === 0 &&
      content.byteLength === content.buffer.byteLength
        ? (content.buffer as ArrayBuffer)
        : (content.slice().buffer as ArrayBuffer);
    this.sql.exec(
      `INSERT INTO files (path, content, media_type, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         content = excluded.content,
         media_type = excluded.media_type,
         updated_at = excluded.updated_at`,
      path,
      buffer,
      mediaType,
      new Date().toISOString()
    );
    this.onChange(this.list());
  }

  delete(path: string) {
    this.sql.exec(`DELETE FROM files WHERE path = ?`, path);
    this.onChange(this.list());
  }
}
