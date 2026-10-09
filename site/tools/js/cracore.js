// EU Cyber Resilience Act (Regulation (EU) 2024/2847), Article 14: the reporting clock for a manufacturer. Pure functions, no DOM.
// Early warning within 24 hours of becoming aware, notification within 72 hours, final report 14 days after a corrective or
// mitigating measure is available (actively exploited vulnerability) or one month after the notification (severe incident).
// Hours are counted as elapsed time and the month as calendar months, both in UTC; the formal counting rules for days and
// months may allow a little more time, so the times shown are the safe moments to plan to.
import { addMonthsUTC, parseDay } from "./utcdate.js?v=11";

export const HOUR = 3600000, DAY = 86400000;
export const KINDS = ["vulnerability", "incident"];
export const STAGES = ["early", "notification", "final"];

/* Parse "YYYY-MM-DDTHH:MM" or "YYYY-MM-DDTHH:MM:SS" (a datetime-local value) as UTC, or null. */
export function parseUtcLocal(s) {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(s ?? "").trim());
  if (!m) return null;
  const day = parseDay(m[1]);
  if (day === null || +m[2] > 23 || +m[3] > 59 || +(m[4] || 0) > 59) return null;
  return day + ((+m[2] * 60 + +m[3]) * 60 + +(m[4] || 0)) * 1000;
}

/* The deadlines. aware: when the manufacturer became aware (ms). Optional: fixAt (vulnerability: a corrective or mitigating
   measure became available), notifiedAt (incident: the 72-hour notification was submitted).
   Returns [{stage, at (ms or null), basis, label}] where basis says what the time counts from:
   "aware" | "fix" | "fix-pending" | "notified" | "notification-deadline". */
export function deadlines(kind, aware, { fixAt = null, notifiedAt = null } = {}) {
  if (!KINDS.includes(kind)) throw new Error("unknown kind " + kind);
  if (!Number.isFinite(aware)) throw new Error("aware time needed");
  const early = aware + 24 * HOUR, notification = aware + 72 * HOUR;
  let fin;
  if (kind === "vulnerability") {
    fin = Number.isFinite(fixAt) ? { at: fixAt + 14 * DAY, basis: "fix" } : { at: null, basis: "fix-pending" };
  } else {
    fin = Number.isFinite(notifiedAt) ? { at: addMonthsUTC(notifiedAt, 1), basis: "notified" } : { at: addMonthsUTC(notification, 1), basis: "notification-deadline" };
  }
  return [
    { stage: "early", at: early, basis: "aware" },
    { stage: "notification", at: notification, basis: "aware" },
    { stage: "final", at: fin.at, basis: fin.basis },
  ];
}

/* Time left until `at`, or overdue: {overdue, days, hours, minutes, seconds, total (ms, signed)}. */
export function remaining(at, now) {
  const total = at - now;
  let s = Math.floor(Math.abs(total) / 1000);
  const days = Math.floor(s / 86400); s -= days * 86400;
  const hours = Math.floor(s / 3600); s -= hours * 3600;
  const minutes = Math.floor(s / 60);
  return { overdue: total < 0, days, hours, minutes, seconds: s - minutes * 60, total };
}

/* Checklist of what each report usually contains, by kind and stage: ids the page turns into sentences. */
export const CONTENTS = {
  vulnerability: {
    early: ["v-exploited", "v-states"],
    notification: ["v-product", "v-nature", "v-measures", "v-users", "v-sensitivity"],
    final: ["v-description", "v-actor", "v-update"],
  },
  incident: {
    early: ["i-severe", "i-malicious"],
    notification: ["i-nature", "i-assessment", "i-measures", "i-users", "i-sensitivity"],
    final: ["i-description", "i-cause", "i-mitigation"],
  },
};
