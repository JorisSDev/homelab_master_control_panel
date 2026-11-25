import { useRef, type ComponentProps, type ReactNode } from "react";
import { ChevronDown, CircleAlert, CircleCheck, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { capacityMb } from "../lib";
import { Alert } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { Progress } from "./ui/progress";

export { Badge };

export function Page({
  title,
  context,
  action,
  children,
  className,
}: {
  title: string;
  context?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("page", className)}>
      <header className="page-head">
        <div>
          <h1 tabIndex={-1}>{title}</h1>
          {context ? <p className="quiet">{context}</p> : null}
        </div>
        {action ? <div className="page-action">{action}</div> : null}
      </header>
      {children}
    </section>
  );
}

export function RouteLink({ go, href = "/", onClick, ...props }: ComponentProps<"a"> & { go: (href: string) => void }) {
  return (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        go(href);
      }}
    />
  );
}

export function Panel({ title, action, children, className }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("surface-card section-panel", className)}>
      <div className="section-heading"><h2 className="section-title">{title}</h2>{action}</div>
      {children}
    </section>
  );
}

export function Disclosure({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <details className="disclosure">
      <summary><span>{label}</span><ChevronDown aria-hidden="true" /></summary>
      <div className="disclosure-body">{children}</div>
    </details>
  );
}

export function Notice({ message, tone = "neutral" }: { message: string; tone?: "neutral" | "warning" | "error" | "success" }) {
  if (!message) return null;
  const Icon = tone === "success" ? CircleCheck : tone === "warning" || tone === "error" ? CircleAlert : Info;
  return <Alert tone={tone}><Icon aria-hidden="true" /><span>{message}</span></Alert>;
}

export function Meter({
  label,
  used,
  free = "",
  total,
  low,
  caption = "used",
}: {
  label: string;
  used?: string;
  free?: string;
  total: string;
  low?: boolean;
  caption?: string;
}) {
  const totalN = capacityMb(total);
  const freeN = capacityMb(free);
  const legacyUsed = totalN !== null && freeN !== null ? Math.max(0, totalN - freeN) : null;
  const usedN = used ? capacityMb(used) : legacyUsed;
  const percent = usedN !== null && totalN !== null && totalN > 0 ? Math.min(100, (usedN / totalN) * 100) : null;
  const amount = used || (usedN === null ? "" : usedN >= 1024 ? `${(usedN / 1024).toFixed(1)} GB` : `${Math.round(usedN)} MB`);
  return (
    <div className="meter">
      <span className="section-label">{label}</span>
      <strong className="figure-value num">{percent !== null ? share(amount, total) : "Unknown"}</strong>
      {percent !== null ? <><span className="meta">{caption}</span><Progress value={percent} low={low} label={`${label} in use`} /></> : null}
    </div>
  );
}

function share(used: string, total: string) {
  const amount = used.trim().match(/^([\d.]+)\s*(\w+)$/);
  const unit = total.trim().match(/[a-z]+$/i)?.[0].toUpperCase();
  return `${amount && amount[2].toUpperCase() === unit ? amount[1] : used.trim()} / ${total.trim()}`;
}

export function Empty({ children }: { children: string }) {
  return <p className="empty">{children}</p>;
}

export function Confirm({
  title,
  children,
  confirmLabel,
  busy,
  onCancel,
  onConfirm,
  returnFocus,
  destructive = false,
  confirmDisabled = false,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  returnFocus?: HTMLElement | null;
  destructive?: boolean;
  confirmDisabled?: boolean;
}) {
  const active = useRef(returnFocus ?? (typeof document === "undefined" ? null : document.activeElement));
  const cancel = useRef<HTMLButtonElement>(null);
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onCancel(); }}>
      <DialogContent
        onOpenAutoFocus={(event) => { event.preventDefault(); cancel.current?.focus(); }}
        onCloseAutoFocus={(event) => {
          if (active.current instanceof HTMLElement && active.current.isConnected) {
            event.preventDefault();
            active.current.focus();
          }
        }}
      >
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription asChild><div className="dialog-detail">{children}</div></DialogDescription>
        <div className="dialog-actions">
          <Button ref={cancel} type="button" variant="outline" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          {confirmDisabled ? null : <Button type="button" variant={destructive ? "destructive" : "default"} disabled={busy} onClick={onConfirm}>
            {busy ? "Working…" : confirmLabel}
          </Button>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
