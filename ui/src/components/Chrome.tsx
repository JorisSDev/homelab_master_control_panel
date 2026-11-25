import type { ReactNode } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { Progress } from "./ui/progress";

export { Badge };

export function Page({
  title,
  context,
  action,
  children,
}: {
  title: string;
  context?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h2>{title}</h2>
          {context ? <p className="quiet">{context}</p> : null}
        </div>
        {action ? <div className="page-action">{action}</div> : null}
      </header>
      {children}
    </section>
  );
}

export function Meter({
  label,
  free,
  total,
  low,
  caption,
  percent,
}: {
  label: string;
  free: string;
  total: string;
  low?: boolean;
  caption?: string;
  percent?: number;
}) {
  const freeN = parseFloat(free) || 0;
  const totalN = parseFloat(total) || 0;
  const used =
    typeof percent === "number"
      ? Math.max(0, Math.min(100, percent))
      : totalN > 0
        ? Math.max(0, Math.min(100, ((totalN - freeN) / totalN) * 100))
        : 0;
  const headline = share(free, total);
  return (
    <div className="meter">
      <span className="section-label">{label}</span>
      <strong className="figure-value num">{headline}</strong>
      <span className="meta">{caption || "free"}</span>
      <Progress value={used} low={low} />
    </div>
  );
}

function share(free: string, total: string) {
  const amount = free.trim().match(/^[\d.]+/)?.[0];
  if (!amount || !total.trim()) {
    return free || "Unknown";
  }
  return `${amount} / ${total.trim()}`;
}

export function Empty({ children }: { children: string }) {
  return <p className="quiet">{children}</p>;
}

export function Confirm({
  title,
  children,
  confirmLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        <div className="mt-3 grid gap-3">{children}</div>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" disabled={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
