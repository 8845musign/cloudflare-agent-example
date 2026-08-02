import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/think/react";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { CircleAlert, RotateCcw, Sparkles } from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse
} from "@/components/ai-elements/message";
import { Shimmer } from "@/components/ai-elements/shimmer";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput
} from "@/components/ai-elements/tool";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  type PromptInputMessage
} from "@/components/ai-elements/prompt-input";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { Button } from "@/components/ui/button";

const suggestions = [
  "このエージェントの特徴を教えて",
  "私の好みを記憶して",
  "簡潔に答えて"
];

const getMessageText = (message: UIMessage) =>
  message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");

export default function App() {
  const agent = useAgent({ agent: "ThinkAgent", name: "default" });
  const {
    messages,
    sendMessage,
    status,
    stop,
    regenerate,
    error,
    clearError,
    connectionError
  } = useAgentChat({ agent });

  const isBusy = status === "submitted" || status === "streaming";
  const displayError = error ?? connectionError;
  const lastMessage = messages.at(-1);
  const lastMessageText = lastMessage ? getMessageText(lastMessage) : "";
  const showThinking =
    isBusy && !(lastMessage?.role === "assistant" && lastMessageText);

  const submitMessage = ({ text }: PromptInputMessage) => {
    const trimmedText = text.trim();
    if (!trimmedText || isBusy) {
      return;
    }

    sendMessage({ text: trimmedText });
  };

  const sendSuggestion = (suggestion: string) => {
    if (isBusy) {
      return;
    }

    sendMessage({ text: suggestion });
  };

  const statusLabel = connectionError
    ? "接続を確認中"
    : status === "submitted"
      ? "送信中"
      : status === "streaming"
        ? "考えています"
        : status === "error"
          ? "エラー"
          : "準備完了";

  return (
    <main className="min-h-dvh bg-[radial-gradient(circle_at_top,_oklch(0.97_0.04_264),_transparent_48%),var(--background)] px-3 py-3 text-foreground sm:px-6 sm:py-6">
      <div className="mx-auto flex min-h-[calc(100dvh-1.5rem)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border bg-card/95 shadow-[0_24px_80px_-36px_oklch(0.35_0.12_264/0.35)] backdrop-blur sm:min-h-[calc(100dvh-3rem)]">
        <header className="flex items-center justify-between gap-4 border-b px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <Sparkles aria-hidden="true" className="size-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate font-semibold text-base tracking-tight sm:text-lg">
                Think Agent
              </h1>
              <p className="truncate text-muted-foreground text-xs sm:text-sm">
                Sessionに記憶されるパーソナルアシスタント
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 text-muted-foreground text-xs">
            <span
              aria-hidden="true"
              className={`size-2 rounded-full ${
                isBusy
                  ? "animate-pulse bg-primary"
                  : displayError
                    ? "bg-destructive"
                    : "bg-emerald-500"
              }`}
            />
            <span className="hidden sm:inline">{statusLabel}</span>
          </div>
        </header>

        <Conversation className="min-h-0 flex-1">
          <ConversationContent className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:px-8 sm:py-8">
            {messages.length === 0 ? (
              <ConversationEmptyState className="min-h-[28rem] flex-1 justify-center px-0 py-10">
                <div className="flex w-full max-w-xl flex-col items-center gap-6">
                  <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <Sparkles aria-hidden="true" className="size-7" />
                  </div>
                  <div className="space-y-2 text-center">
                    <h2 className="font-semibold text-xl tracking-tight sm:text-2xl">
                      何から始めますか？
                    </h2>
                    <p className="text-muted-foreground text-sm">
                      会話を重ねるほど、あなたに合った応答になります。
                    </p>
                  </div>
                  <Suggestions className="justify-center gap-2 whitespace-normal">
                    {suggestions.map((suggestion) => (
                      <Suggestion
                        disabled={isBusy}
                        key={suggestion}
                        onClick={sendSuggestion}
                        suggestion={suggestion}
                      />
                    ))}
                  </Suggestions>
                </div>
              </ConversationEmptyState>
            ) : (
              <>
                {messages.map((message, index) => {
                  const text = getMessageText(message);
                  const hasToolPart = message.parts.some((part) =>
                    isToolUIPart(part)
                  );
                  if (!text && !hasToolPart) {
                    return null;
                  }

                  const isAnimating =
                    isBusy &&
                    message.role === "assistant" &&
                    index === messages.length - 1;

                  return (
                    <Message from={message.role} key={message.id}>
                      <MessageContent>
                        {message.parts.map((part, partIndex) => {
                          if (part.type === "text" && part.text) {
                            return (
                              <MessageResponse
                                className="message-markdown"
                                isAnimating={isAnimating}
                                key={`${message.id}-text-${partIndex}`}
                              >
                                {part.text}
                              </MessageResponse>
                            );
                          }

                          if (!isToolUIPart(part)) {
                            return null;
                          }

                          const toolName = getToolName(part);
                          return (
                            <Tool
                              defaultOpen
                              key={`${message.id}-tool-${partIndex}`}
                            >
                              <ToolHeader
                                state={part.state}
                                title={toolName}
                                toolName={
                                  part.type === "dynamic-tool"
                                    ? toolName
                                    : undefined
                                }
                                type={part.type}
                              />
                              <ToolContent>
                                <ToolInput input={part.input} />
                                <ToolOutput
                                  errorText={part.errorText}
                                  output={part.output}
                                />
                              </ToolContent>
                            </Tool>
                          );
                        })}
                      </MessageContent>
                    </Message>
                  );
                })}
                {showThinking ? (
                  <Message from="assistant" key="thinking-indicator">
                    <MessageContent>
                      <div
                        aria-live="polite"
                        className="flex items-center gap-3 text-muted-foreground text-sm"
                      >
                        <span
                          aria-hidden="true"
                          className="flex items-center gap-1"
                        >
                          <span className="size-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.3s]" />
                          <span className="size-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.15s]" />
                          <span className="size-1.5 animate-bounce rounded-full bg-primary" />
                        </span>
                        <Shimmer as="span" className="font-medium">
                          考えています…
                        </Shimmer>
                      </div>
                    </MessageContent>
                  </Message>
                ) : null}
              </>
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <div className="border-t bg-background/75 px-3 py-3 sm:px-6 sm:py-4">
          <div className="mx-auto w-full max-w-3xl space-y-3">
            {displayError ? (
              <div
                className="flex items-center justify-between gap-3 rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-2 text-destructive text-sm"
                role="alert"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
                  <span className="truncate">
                    {displayError.message || "応答の取得に失敗しました。"}
                  </span>
                </div>
                <Button
                  className="shrink-0"
                  onClick={() => {
                    clearError();
                    void regenerate();
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <RotateCcw aria-hidden="true" className="size-3.5" />
                  再試行
                </Button>
              </div>
            ) : null}

            <PromptInput aria-label="メッセージ入力" onSubmit={submitMessage}>
              <PromptInputTextarea
                aria-label="メッセージ"
                disabled={isBusy}
                placeholder="メッセージを入力してください…"
              />
              <PromptInputFooter>
                <PromptInputTools>
                  <span className="px-1 text-muted-foreground text-xs">
                    Enterで送信 · Shift+Enterで改行
                  </span>
                </PromptInputTools>
                <PromptInputSubmit
                  aria-label={isBusy ? "生成を停止" : "送信"}
                  onStop={stop}
                  status={isBusy ? status : "ready"}
                />
              </PromptInputFooter>
            </PromptInput>
          </div>
        </div>
      </div>
    </main>
  );
}
