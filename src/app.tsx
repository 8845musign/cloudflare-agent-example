import { Suspense, useCallback, useState, useEffect, useRef } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import type {
  ChatAgent,
  FileMeta,
  NewsRun,
  WorkspaceState
} from "./server/agent";
import {
  Badge,
  Button,
  Empty,
  InputArea,
  Surface,
  Switch,
  Text
} from "@cloudflare/kumo";
import { Streamdown } from "streamdown";
import { code } from "@streamdown/code";
import {
  PaperPlaneRightIcon,
  StopIcon,
  TrashIcon,
  GearIcon,
  ChatCircleDotsIcon,
  CircleIcon,
  MoonIcon,
  SunIcon,
  CheckCircleIcon,
  XCircleIcon,
  BrainIcon,
  CaretDownIcon,
  BugIcon,
  FileIcon,
  FilesIcon,
  ImageIcon,
  XIcon,
  PaperclipIcon,
  ArrowSquareOutIcon,
  NewspaperIcon
} from "@phosphor-icons/react";

// ── Workspace ─────────────────────────────────────────────────────────
// One workspace = one agent instance (Durable Object), selected by URL:
//   /            → "default"
//   /w/:name     → ":name"

function getWorkspaceFromUrl(): string {
  const match = location.pathname.match(/^\/w\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : "default";
}

const WORKSPACE = getWorkspaceFromUrl();

function fileUrl(path: string, version?: string) {
  const v = version ? `&v=${encodeURIComponent(version)}` : "";
  return `/agents/chat-agent/${WORKSPACE}/file?path=${encodeURIComponent(path)}${v}`;
}

// ── Attachment helpers ────────────────────────────────────────────────

interface Attachment {
  id: string;
  file: File;
  preview: string;
  mediaType: string;
}

function createAttachment(file: File): Attachment {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    file,
    preview: URL.createObjectURL(file),
    mediaType: file.type || "application/octet-stream"
  };
}

function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── Small components ──────────────────────────────────────────────────

function ThemeToggle() {
  const [dark, setDark] = useState(
    () => document.documentElement.getAttribute("data-mode") === "dark"
  );

  const toggle = useCallback(() => {
    const next = !dark;
    setDark(next);
    const mode = next ? "dark" : "light";
    document.documentElement.setAttribute("data-mode", mode);
    document.documentElement.style.colorScheme = mode;
    localStorage.setItem("theme", mode);
  }, [dark]);

  return (
    <Button
      variant="secondary"
      shape="square"
      icon={dark ? <SunIcon size={16} /> : <MoonIcon size={16} />}
      onClick={toggle}
      aria-label="Toggle theme"
    />
  );
}

function WorkspaceSwitcher() {
  const [name, setName] = useState(WORKSPACE);

  const go = () => {
    const next = name.trim().replace(/[^A-Za-z0-9_-]/g, "-");
    if (next && next !== WORKSPACE) {
      location.href = `/w/${next}`;
    }
  };

  return (
    <input
      type="text"
      value={name}
      onChange={(e) => setName(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") go();
      }}
      onBlur={() => setName(WORKSPACE)}
      aria-label="Workspace name (Enter to switch)"
      title="Workspace name — press Enter to switch"
      className="w-28 px-2 py-1 text-xs font-mono rounded-lg border border-kumo-line bg-kumo-base text-kumo-default focus:outline-none focus:ring-1 focus:ring-kumo-accent"
    />
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── File panel ────────────────────────────────────────────────────────

function FilePanel({ files }: { files: FileMeta[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);

  const meta = files.find((f) => f.path === selected) ?? null;
  const isImage = meta?.mediaType.startsWith("image/") ?? false;

  // Clear selection when the file disappears
  useEffect(() => {
    if (selected && !files.some((f) => f.path === selected)) {
      setSelected(null);
      setContent(null);
    }
  }, [files, selected]);

  // (Re)load text content when the selected file changes or is updated
  useEffect(() => {
    if (!meta || isImage) {
      setContent(null);
      return;
    }
    let cancelled = false;
    fetch(fileUrl(meta.path, meta.updatedAt))
      .then((res) => (res.ok ? res.text() : Promise.reject(res.status)))
      .then((text) => {
        if (!cancelled) setContent(text);
      })
      .catch(() => {
        if (!cancelled) setContent("(failed to load file)");
      });
    return () => {
      cancelled = true;
    };
  }, [meta, isImage]);

  return (
    <div className="flex flex-col h-full bg-kumo-base">
      <div className="px-4 py-3 border-b border-kumo-line flex items-center gap-2">
        <FilesIcon size={16} className="text-kumo-accent" />
        <Text size="sm" bold>
          Files
        </Text>
        <Badge variant="secondary">{files.length}</Badge>
      </div>

      <div className="overflow-y-auto border-b border-kumo-line max-h-[40%] shrink-0">
        {files.length === 0 ? (
          <div className="px-4 py-6 text-center">
            <Text size="xs" variant="secondary">
              No files yet — ask the agent to create one.
            </Text>
          </div>
        ) : (
          <ul>
            {files.map((f) => (
              <li key={f.path}>
                <button
                  type="button"
                  onClick={() => setSelected(f.path)}
                  className={`w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-kumo-control ${
                    selected === f.path ? "bg-kumo-control" : ""
                  }`}
                >
                  {f.mediaType.startsWith("image/") ? (
                    <ImageIcon
                      size={14}
                      className="text-kumo-inactive shrink-0"
                    />
                  ) : (
                    <FileIcon
                      size={14}
                      className="text-kumo-inactive shrink-0"
                    />
                  )}
                  <span className="text-xs font-mono text-kumo-default truncate flex-1">
                    {f.path}
                  </span>
                  <span className="text-[10px] text-kumo-subtle shrink-0">
                    {formatSize(f.size)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {meta ? (
          <div className="p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Text size="xs" variant="secondary" bold>
                {meta.path}
              </Text>
              <a
                href={fileUrl(meta.path, meta.updatedAt)}
                target="_blank"
                rel="noreferrer"
                aria-label="Open raw file in new tab"
                className="text-kumo-inactive hover:text-kumo-default"
              >
                <ArrowSquareOutIcon size={12} />
              </a>
            </div>
            {isImage ? (
              <img
                src={fileUrl(meta.path, meta.updatedAt)}
                alt={meta.path}
                className="max-w-full rounded-lg border border-kumo-line"
              />
            ) : (
              <pre className="text-xs text-kumo-default whitespace-pre-wrap break-words bg-kumo-control rounded-lg p-3 overflow-auto">
                {content ?? "Loading..."}
              </pre>
            )}
          </div>
        ) : (
          <div className="h-full flex items-center justify-center">
            <Text size="xs" variant="secondary">
              Select a file to view it
            </Text>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tool rendering ────────────────────────────────────────────────────

function ToolPartView({
  part,
  addToolApprovalResponse
}: {
  part: UIMessage["parts"][number];
  addToolApprovalResponse: (response: {
    id: string;
    approved: boolean;
  }) => void;
}) {
  if (!isToolUIPart(part)) return null;
  const toolName = getToolName(part);

  // Completed
  if (part.state === "output-available") {
    const output = part.output as { ok?: boolean; path?: string } | undefined;
    const isScreenshot =
      toolName === "screenshot" && output?.ok === true && !!output.path;

    return (
      <div className="flex justify-start">
        <Surface className="max-w-[85%] px-4 py-2.5 rounded-xl ring ring-kumo-line">
          <div className="flex items-center gap-2 mb-1">
            <GearIcon size={14} className="text-kumo-inactive" />
            <Text size="xs" variant="secondary" bold>
              {toolName}
            </Text>
            <Badge variant="secondary">Done</Badge>
          </div>
          {isScreenshot ? (
            <div className="space-y-1">
              <img
                src={fileUrl(output.path as string)}
                alt={`Screenshot: ${output.path}`}
                className="max-h-80 rounded-lg border border-kumo-line"
              />
              <div className="font-mono">
                <Text size="xs" variant="secondary">
                  saved to {output.path}
                </Text>
              </div>
            </div>
          ) : (
            <div className="font-mono">
              <Text size="xs" variant="secondary">
                {JSON.stringify(part.output, null, 2)}
              </Text>
            </div>
          )}
        </Surface>
      </div>
    );
  }

  // Needs approval
  if ("approval" in part && part.state === "approval-requested") {
    const approvalId = (part.approval as { id?: string })?.id;
    return (
      <div className="flex justify-start">
        <Surface className="max-w-[85%] px-4 py-3 rounded-xl ring-2 ring-kumo-warning">
          <div className="flex items-center gap-2 mb-2">
            <GearIcon size={14} className="text-kumo-warning" />
            <Text size="sm" bold>
              Approval needed: {toolName}
            </Text>
          </div>
          <div className="font-mono mb-3 max-h-48 overflow-auto">
            <Text size="xs" variant="secondary">
              {JSON.stringify(part.input, null, 2)}
            </Text>
          </div>
          <div className="flex gap-2">
            <Button
              variant="primary"
              size="sm"
              icon={<CheckCircleIcon size={14} />}
              onClick={() => {
                if (approvalId) {
                  addToolApprovalResponse({ id: approvalId, approved: true });
                }
              }}
            >
              Approve
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<XCircleIcon size={14} />}
              onClick={() => {
                if (approvalId) {
                  addToolApprovalResponse({ id: approvalId, approved: false });
                }
              }}
            >
              Reject
            </Button>
          </div>
        </Surface>
      </div>
    );
  }

  // Rejected / denied
  if (
    part.state === "output-denied" ||
    ("approval" in part &&
      (part.approval as { approved?: boolean })?.approved === false)
  ) {
    return (
      <div className="flex justify-start">
        <Surface className="max-w-[85%] px-4 py-2.5 rounded-xl ring ring-kumo-line">
          <div className="flex items-center gap-2">
            <XCircleIcon size={14} className="text-kumo-danger" />
            <Text size="xs" variant="secondary" bold>
              {toolName}
            </Text>
            <Badge variant="secondary">Rejected</Badge>
          </div>
        </Surface>
      </div>
    );
  }

  // Executing
  if (part.state === "input-available" || part.state === "input-streaming") {
    return (
      <div className="flex justify-start">
        <Surface className="max-w-[85%] px-4 py-2.5 rounded-xl ring ring-kumo-line">
          <div className="flex items-center gap-2">
            <GearIcon size={14} className="text-kumo-inactive animate-spin" />
            <Text size="xs" variant="secondary">
              Running {toolName}...
            </Text>
          </div>
        </Surface>
      </div>
    );
  }

  return null;
}

// ── Main chat ─────────────────────────────────────────────────────────

function Chat() {
  const [connected, setConnected] = useState(false);
  const [input, setInput] = useState("");
  const [showDebug, setShowDebug] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState<FileMeta[]>([]);
  const [newsRun, setNewsRun] = useState<NewsRun | undefined>(undefined);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const agent = useAgent<ChatAgent, WorkspaceState>({
    agent: "ChatAgent",
    name: WORKSPACE,
    onOpen: useCallback(() => setConnected(true), []),
    onClose: useCallback(() => setConnected(false), []),
    onError: useCallback(
      (error: Event) => console.error("WebSocket error:", error),
      []
    ),
    onStateUpdate: useCallback((state: WorkspaceState) => {
      setFiles(state.files ?? []);
      setNewsRun(state.newsRun);
    }, [])
  });

  const {
    messages,
    sendMessage,
    clearHistory,
    addToolApprovalResponse,
    stop,
    status
  } = useAgentChat({
    agent,
    experimental_throttle: 100
  });

  const isStreaming = status === "streaming" || status === "submitted";

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Re-focus the input after streaming ends
  useEffect(() => {
    if (!isStreaming && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isStreaming]);

  const addFiles = useCallback((fileList: FileList | File[]) => {
    const images = Array.from(fileList).filter((f) =>
      f.type.startsWith("image/")
    );
    if (images.length === 0) return;
    setAttachments((prev) => [...prev, ...images.map(createAttachment)]);
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const att = prev.find((a) => a.id === id);
      if (att) URL.revokeObjectURL(att.preview);
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes("Files")) setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget === e.target) setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
    },
    [addFiles]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const pasted: File[] = [];
      for (const item of items) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) pasted.push(file);
        }
      }
      if (pasted.length > 0) {
        e.preventDefault();
        addFiles(pasted);
      }
    },
    [addFiles]
  );

  const newsRunning = newsRun?.status === "running";

  const startNewsRunbook = useCallback(() => {
    agent
      .call("startNewsRunbook")
      .catch((err) => console.error("Failed to start news runbook:", err));
  }, [agent]);

  const send = useCallback(async () => {
    const text = input.trim();
    if ((!text && attachments.length === 0) || isStreaming) return;
    setInput("");

    const parts: Array<
      | { type: "text"; text: string }
      | { type: "file"; mediaType: string; url: string }
    > = [];
    if (text) parts.push({ type: "text", text });

    for (const att of attachments) {
      const dataUri = await fileToDataUri(att.file);
      parts.push({ type: "file", mediaType: att.mediaType, url: dataUri });
    }

    for (const att of attachments) URL.revokeObjectURL(att.preview);
    setAttachments([]);

    sendMessage({ role: "user", parts });
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, [input, attachments, isStreaming, sendMessage]);

  return (
    <div
      className="flex flex-col h-screen bg-kumo-elevated relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-kumo-elevated/80 backdrop-blur-sm border-2 border-dashed border-kumo-brand rounded-xl m-2 pointer-events-none">
          <div className="flex flex-col items-center gap-2 text-kumo-brand">
            <ImageIcon size={40} />
            <Text variant="heading3" as="span">
              Drop images here
            </Text>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="px-5 py-4 bg-kumo-base border-b border-kumo-line">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold text-kumo-default">
              <span className="mr-2">⛅</span>Agent Workspace
            </h1>
            <Badge variant="secondary">
              <ChatCircleDotsIcon size={12} weight="bold" className="mr-1" />
              {WORKSPACE}
            </Badge>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <CircleIcon
                size={8}
                weight="fill"
                className={connected ? "text-kumo-success" : "text-kumo-danger"}
              />
              <Text size="xs" variant="secondary">
                {connected ? "Connected" : "Disconnected"}
              </Text>
            </div>
            <WorkspaceSwitcher />
            <div className="flex items-center gap-1.5">
              <BugIcon size={14} className="text-kumo-inactive" />
              <Switch
                checked={showDebug}
                onCheckedChange={setShowDebug}
                size="sm"
                aria-label="Toggle debug mode"
              />
            </div>
            <ThemeToggle />
            <Button
              variant="secondary"
              icon={<TrashIcon size={16} />}
              onClick={clearHistory}
            >
              Clear
            </Button>
          </div>
        </div>
      </header>

      {/* Chat + file panel */}
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 flex flex-col min-w-0">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-3xl mx-auto px-5 py-6 space-y-5">
              {messages.length === 0 && (
                <Empty
                  icon={<ChatCircleDotsIcon size={32} />}
                  title="Start a conversation"
                  contents={
                    <div className="flex flex-wrap justify-center gap-2">
                      {[
                        "example.com を開いて内容を要約して",
                        "news.ycombinator.com のスクリーンショットを撮って",
                        "notes/todo.md を作って今日のタスクを3つ書いて",
                        "ワークスペースのファイル一覧を見せて"
                      ].map((prompt) => (
                        <Button
                          key={prompt}
                          variant="outline"
                          size="sm"
                          disabled={isStreaming}
                          onClick={() => {
                            sendMessage({
                              role: "user",
                              parts: [{ type: "text", text: prompt }]
                            });
                          }}
                        >
                          {prompt}
                        </Button>
                      ))}
                    </div>
                  }
                />
              )}

              {messages.map((message: UIMessage, index: number) => {
                const isUser = message.role === "user";
                const isLastAssistant =
                  message.role === "assistant" && index === messages.length - 1;

                return (
                  <div key={message.id} className="space-y-2">
                    {showDebug && (
                      <pre className="text-[11px] text-kumo-subtle bg-kumo-control rounded-lg p-3 overflow-auto max-h-64">
                        {JSON.stringify(message, null, 2)}
                      </pre>
                    )}

                    {/* Tool parts */}
                    {message.parts.filter(isToolUIPart).map((part) => (
                      <ToolPartView
                        key={part.toolCallId}
                        part={part}
                        addToolApprovalResponse={addToolApprovalResponse}
                      />
                    ))}

                    {/* Reasoning parts */}
                    {message.parts
                      .filter(
                        (part) =>
                          part.type === "reasoning" &&
                          (part as { text?: string }).text?.trim()
                      )
                      .map((part, i) => {
                        const reasoning = part as {
                          type: "reasoning";
                          text: string;
                          state?: "streaming" | "done";
                        };
                        // A part that reports its own "streaming" state (e.g. a
                        // running workflow) is never done, even when the chat
                        // itself is idle.
                        const isDone =
                          reasoning.state === "done" ||
                          (reasoning.state !== "streaming" && !isStreaming);
                        const latestLine = reasoning.text
                          .split("\n")
                          .map((l) => l.trim())
                          .filter(Boolean)
                          .at(-1);
                        return (
                          <div key={i} className="flex justify-start">
                            <details
                              className="max-w-[85%] w-full"
                              open={!isDone}
                            >
                              <summary
                                aria-label="Reasoning"
                                className="list-none cursor-pointer select-none [&::-webkit-details-marker]:hidden"
                              >
                                <Surface className="px-4 py-2.5 rounded-xl ring ring-kumo-line">
                                  <div className="flex items-center gap-2">
                                    <BrainIcon
                                      size={14}
                                      className="text-kumo-inactive shrink-0"
                                    />
                                    <Text size="xs" variant="secondary" bold>
                                      Reasoning
                                    </Text>
                                    <Badge variant="secondary">
                                      {isDone ? "Done" : "Thinking..."}
                                    </Badge>
                                    {!isDone && latestLine && (
                                      <span className="flex-1 min-w-0 truncate text-xs text-kumo-subtle">
                                        {latestLine}
                                      </span>
                                    )}
                                    <CaretDownIcon
                                      size={14}
                                      className="ml-auto shrink-0 text-kumo-inactive"
                                    />
                                  </div>
                                </Surface>
                              </summary>
                              <Surface className="mt-1 px-4 py-2.5 rounded-xl ring ring-kumo-line">
                                <pre className="text-xs text-kumo-default whitespace-pre-wrap break-words overflow-auto max-h-64 font-mono">
                                  {reasoning.text}
                                </pre>
                              </Surface>
                            </details>
                          </div>
                        );
                      })}

                    {/* Image parts */}
                    {message.parts
                      .filter(
                        (
                          part
                        ): part is Extract<typeof part, { type: "file" }> =>
                          part.type === "file" &&
                          (
                            part as { mediaType?: string }
                          ).mediaType?.startsWith("image/") === true
                      )
                      .map((part, i) => (
                        <div
                          key={`file-${i}`}
                          className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                        >
                          <img
                            src={part.url}
                            alt="Attachment"
                            className="max-h-64 rounded-xl border border-kumo-line object-contain"
                          />
                        </div>
                      ))}

                    {/* Text parts */}
                    {message.parts
                      .filter((part) => part.type === "text")
                      .map((part, i) => {
                        const text = (part as { type: "text"; text: string })
                          .text;
                        if (!text) return null;

                        if (isUser) {
                          return (
                            <div key={i} className="flex justify-end">
                              <div className="max-w-[85%] px-4 py-2.5 rounded-2xl rounded-br-md bg-kumo-contrast text-kumo-inverse leading-relaxed">
                                {text}
                              </div>
                            </div>
                          );
                        }

                        return (
                          <div key={i} className="flex justify-start">
                            <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-kumo-base text-kumo-default leading-relaxed">
                              <Streamdown
                                className="sd-theme rounded-2xl rounded-bl-md p-3"
                                plugins={{ code }}
                                controls={false}
                                isAnimating={isLastAssistant && isStreaming}
                              >
                                {text}
                              </Streamdown>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                );
              })}

              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Input */}
          <div className="border-t border-kumo-line bg-kumo-base">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
              className="max-w-3xl mx-auto px-5 py-4"
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*"
                aria-label="Upload image attachments"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files);
                  e.target.value = "";
                }}
              />

              <div className="flex items-center gap-3 mb-2 flex-wrap">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  icon={
                    newsRunning ? (
                      <GearIcon size={14} className="animate-spin" />
                    ) : (
                      <NewspaperIcon size={14} />
                    )
                  }
                  onClick={startNewsRunbook}
                  disabled={!connected || newsRunning}
                >
                  今日のニュースは?
                </Button>
              </div>

              {attachments.length > 0 && (
                <div className="flex gap-2 mb-2 flex-wrap">
                  {attachments.map((att) => (
                    <div
                      key={att.id}
                      className="relative group rounded-lg border border-kumo-line bg-kumo-control overflow-hidden"
                    >
                      <img
                        src={att.preview}
                        alt={att.file.name}
                        className="h-16 w-16 object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => removeAttachment(att.id)}
                        className="absolute top-0.5 right-0.5 rounded-full bg-kumo-contrast/80 text-kumo-inverse p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                        aria-label={`Remove ${att.file.name}`}
                      >
                        <XIcon size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-end gap-3 rounded-xl border border-kumo-line bg-kumo-base p-3 shadow-sm focus-within:ring-2 focus-within:ring-kumo-ring focus-within:border-transparent transition-shadow">
                <Button
                  type="button"
                  variant="ghost"
                  shape="square"
                  aria-label="Attach images"
                  icon={<PaperclipIcon size={18} />}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!connected || isStreaming}
                  className="mb-0.5"
                />
                <InputArea
                  ref={textareaRef}
                  value={input}
                  onValueChange={setInput}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  onInput={(e) => {
                    const el = e.currentTarget;
                    el.style.height = "auto";
                    el.style.height = `${el.scrollHeight}px`;
                  }}
                  onPaste={handlePaste}
                  placeholder={
                    attachments.length > 0
                      ? "Add a message or send images..."
                      : "Send a message..."
                  }
                  disabled={!connected || isStreaming}
                  rows={1}
                  className="flex-1 ring-0! focus:ring-0! shadow-none! bg-transparent! outline-none! resize-none max-h-40"
                />
                {isStreaming ? (
                  <Button
                    type="button"
                    variant="secondary"
                    shape="square"
                    aria-label="Stop generation"
                    icon={<StopIcon size={18} />}
                    onClick={stop}
                    className="mb-0.5"
                  />
                ) : (
                  <Button
                    type="submit"
                    variant="primary"
                    shape="square"
                    aria-label="Send message"
                    disabled={
                      (!input.trim() && attachments.length === 0) || !connected
                    }
                    icon={<PaperPlaneRightIcon size={18} />}
                    className="mb-0.5"
                  />
                )}
              </div>
            </form>
          </div>
        </div>

        {/* File panel */}
        <aside className="hidden md:block w-96 shrink-0 border-l border-kumo-line">
          <FilePanel files={files} />
        </aside>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-screen text-kumo-inactive">
          Loading...
        </div>
      }
    >
      <Chat />
    </Suspense>
  );
}
