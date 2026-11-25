import type { ProtectionRow } from "../types";

const timestamp = new Intl.DateTimeFormat("lt-LT", { dateStyle: "short", timeStyle: "short" });

export function BackupSchedule({ row }: { row: ProtectionRow }) {
  const destinations = row.backup_destinations?.join(", ");
  return <>
    {row.next_backup ? <BackupTime at={row.next_backup} /> : row.backup === "Scheduled" ? "Next run unavailable" : "—"}
    {destinations ? <span className="meta"> · {destinations}</span> : null}
  </>;
}

export function BackupArchive({ row }: { row: ProtectionRow }) {
  const archive = row.latest_backup;
  if (!row.id) return "—";
  if (!archive) return row.archives_complete ? "No archive found" : "Archive list unavailable";
  return <><BackupTime at={archive.at} /><span className="meta"> · {archive.storage}{row.archives_complete === false ? " · Partial listing" : ""}</span></>;
}

function BackupTime({ at }: { at: number }) {
  const date = new Date(at * 1000);
  return <time className="num" dateTime={date.toISOString()}>{timestamp.format(date)}</time>;
}
