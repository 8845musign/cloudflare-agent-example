"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { DynamicToolUIPart, ToolUIPart } from "ai";
import {
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock3,
  LoaderCircle,
  Wrench,
  XCircle
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { isValidElement } from "react";

export type ToolPart = ToolUIPart | DynamicToolUIPart;

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible
    className={cn(
      "group not-prose w-full overflow-hidden rounded-xl border bg-card/60",
      className
    )}
    {...props}
  />
);

const statusLabels: Record<ToolPart["state"], string> = {
  "approval-requested": "承認待ち",
  "approval-responded": "承認済み",
  "input-available": "実行中",
  "input-streaming": "準備中",
  "output-available": "完了",
  "output-denied": "拒否",
  "output-error": "エラー"
};

const statusIcons: Record<ToolPart["state"], ReactNode> = {
  "approval-requested": <Clock3 className="size-3.5 text-amber-600" />,
  "approval-responded": <CheckCircle2 className="size-3.5 text-blue-600" />,
  "input-available": (
    <LoaderCircle className="size-3.5 animate-spin text-primary" />
  ),
  "input-streaming": <Circle className="size-3.5 text-muted-foreground" />,
  "output-available": <CheckCircle2 className="size-3.5 text-emerald-600" />,
  "output-denied": <XCircle className="size-3.5 text-amber-600" />,
  "output-error": <XCircle className="size-3.5 text-destructive" />
};

const StatusBadge = ({ status }: { status: ToolPart["state"] }) => (
  <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground text-xs">
    {statusIcons[status]}
    {statusLabels[status]}
  </span>
);

export type ToolHeaderProps = Omit<
  ComponentProps<typeof CollapsibleTrigger>,
  "type"
> & {
  title?: string;
  type: ToolPart["type"];
  state: ToolPart["state"];
  toolName?: string;
};

export const ToolHeader = ({
  className,
  title,
  type,
  state,
  toolName,
  ...props
}: ToolHeaderProps) => {
  const derivedName =
    type === "dynamic-tool" ? (toolName ?? "tool") : type.replace(/^tool-/, "");

  return (
    <CollapsibleTrigger
      className={cn(
        "flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/60",
        className
      )}
      {...props}
    >
      <span className="flex min-w-0 items-center gap-2">
        <Wrench
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground"
        />
        <span className="truncate font-medium text-sm">
          {title ?? derivedName}
        </span>
        <StatusBadge status={state} />
      </span>
      <ChevronDown
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
      />
    </CollapsibleTrigger>
  );
};

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      "space-y-3 border-t bg-muted/20 p-3 text-sm outline-none",
      className
    )}
    {...props}
  />
);

const stringifyValue = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
};

const CodeValue = ({ value }: { value: unknown }) => (
  <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-xs leading-relaxed">
    {stringifyValue(value)}
  </pre>
);

export type ToolInputProps = ComponentProps<"div"> & {
  input?: unknown;
};

export const ToolInput = ({ input, className, ...props }: ToolInputProps) => {
  if (input === undefined) {
    return null;
  }

  return (
    <div className={cn("space-y-1.5 overflow-hidden", className)} {...props}>
      <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        入力
      </h4>
      <div className="overflow-hidden rounded-lg bg-muted/60 text-foreground">
        <CodeValue value={input} />
      </div>
    </div>
  );
};

export type ToolOutputProps = ComponentProps<"div"> & {
  output?: unknown;
  errorText?: string;
};

export const ToolOutput = ({
  output,
  errorText,
  className,
  ...props
}: ToolOutputProps) => {
  if (output === undefined && !errorText) {
    return null;
  }

  let renderedOutput: ReactNode = null;
  if (output !== undefined) {
    renderedOutput = isValidElement(output) ? (
      output
    ) : (
      <CodeValue value={output} />
    );
  }

  return (
    <div className={cn("space-y-1.5 overflow-hidden", className)} {...props}>
      <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {errorText ? "エラー" : "結果"}
      </h4>
      <div
        className={cn(
          "overflow-hidden rounded-lg text-xs",
          errorText
            ? "bg-destructive/10 text-destructive"
            : "bg-muted/60 text-foreground"
        )}
      >
        {errorText ? <div className="p-3">{errorText}</div> : null}
        {renderedOutput}
      </div>
    </div>
  );
};
