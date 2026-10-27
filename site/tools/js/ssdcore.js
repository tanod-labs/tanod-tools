// SSD health check, pure logic (no DOM): parses `smartctl -a`, `smartctl -j` and `nvme smart-log` output and rates it.
// Nothing here touches the network; the page passes in the text the visitor pasted.

export const BYTES_PER_UNIT = 512000; // NVMe "data unit" = 1000 x 512-byte blocks

const num = (s) => {
  if (typeof s !== "number" && typeof s !== "string") return null;
  const t = String(s).replace(/[,\s_]/g, "");
  const m = /^\d+(\.\d+)?/.exec(t);
  const n = typeof s === "number" ? s : m ? Number(m[0]) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/* Numbers in nvme-cli and smartctl text use "," or "." as thousands separators ("12,345,678" or "12.345.678"). */
function bigNum(s) {
  if (s === undefined || s === null) return null;
  const m = /-?\d[\d,.   ]*/.exec(String(s));
  if (!m) return null;
  const t = m[0].trim();
  if (/^\d{1,3}([,.   ]\d{3})+$/.test(t)) return Number(t.replace(/[^\d]/g, ""));
  return num(t);
}

function fromJson(j) {
  if (!j || typeof j !== "object" || Array.isArray(j)) return null;
  const log = j.nvme_smart_health_information_log;
  const out = { source: "smartctl -j", kind: "nvme" };
  out.model = j.model_name || j.device?.name || null;
  const cap = j.nvme_total_capacity ?? j.user_capacity?.bytes;
  out.capacityBytes = typeof cap === "number" ? cap : null;
  if (log && typeof log === "object" && !Array.isArray(log)) {
    out.criticalWarning = log.critical_warning ?? null;
    out.temperature = log.temperature ?? null;
    out.spare = log.available_spare ?? null;
    out.spareThreshold = log.available_spare_threshold ?? null;
    out.percentUsed = log.percentage_used ?? null;
    out.unitsWritten = log.data_units_written ?? null;
    out.unitsRead = log.data_units_read ?? null;
    out.powerCycles = log.power_cycles ?? null;
    out.powerOnHours = log.power_on_hours ?? j.power_on_time?.hours ?? null;
    out.unsafeShutdowns = log.unsafe_shutdowns ?? null;
    out.mediaErrors = log.media_errors ?? null;
    out.errorLogEntries = log.num_err_log_entries ?? null;
    return out;
  }
  // nvme-cli `nvme smart-log -o json`
  if ("percent_used" in j || "avail_spare" in j) {
    out.source = "nvme smart-log -o json";
    out.criticalWarning = j.critical_warning ?? null;
    out.temperature = typeof j.temperature === "number" ? (j.temperature > 200 ? j.temperature - 273 : j.temperature) : null;
    out.spare = j.avail_spare ?? null;
    out.spareThreshold = j.spare_thresh ?? null;
    out.percentUsed = j.percent_used ?? null;
    out.unitsWritten = j.data_units_written ?? null;
    out.unitsRead = j.data_units_read ?? null;
    out.powerCycles = j.power_cycles ?? null;
    out.powerOnHours = j.power_on_hours ?? null;
    out.unsafeShutdowns = j.unsafe_shutdowns ?? null;
    out.mediaErrors = j.media_errors ?? null;
    out.errorLogEntries = j.num_err_log_entries ?? null;
    return out;
  }
  // SATA drive in smartctl -j
  if (Array.isArray(j.ata_smart_attributes?.table)) {
    const t = j.ata_smart_attributes.table.filter((a) => a && typeof a === "object" && !Array.isArray(a));
    return Object.assign(out, sataFromRows(t.map((a) => ({ id: a.id, name: a.name, value: a.value, worst: a.worst, thresh: a.thresh, raw: a.raw?.value ?? a.raw }))),
      { kind: "sata", powerOnHours: j.power_on_time?.hours ?? null });
  }
  return null;
}

const ATTR = (rows, ...names) => rows.find((r) => names.includes(r.name) || names.includes(r.id));

function sataFromRows(rows) {
  const out = { kind: "sata" };
  const poh = ATTR(rows, "Power_On_Hours", 9);
  out.powerOnHours = poh ? poh.raw : null;
  const pc = ATTR(rows, "Power_Cycle_Count", 12);
  out.powerCycles = pc ? pc.raw : null;
  const re = ATTR(rows, "Reallocated_Sector_Ct", 5);
  out.reallocated = re ? re.raw : null;
  const pend = ATTR(rows, "Current_Pending_Sector", 197);
  out.pending = pend ? pend.raw : null;
  const unc = ATTR(rows, "Offline_Uncorrectable", "Reported_Uncorrect", 198, 187);
  out.uncorrectable = unc ? unc.raw : null;
  const up = ATTR(rows, "Unexpected_Power_Loss_Ct", "Unexpect_Power_Loss_Ct", "Power-Off_Retract_Count", 174);
  out.unsafeShutdowns = up ? up.raw : null;
  // Wear attributes report a normalized value that counts down from 100 (life left).
  const wear = ATTR(rows, "Wear_Leveling_Count", "Media_Wearout_Indicator", "SSD_Life_Left", "Percent_Lifetime_Remain", "Remaining_Lifetime_Perc", 177, 231, 233, 202);
  if (wear && typeof wear.value === "number" && wear.value >= 0 && wear.value <= 100) {
    out.lifeLeft = wear.value;
    out.percentUsed = 100 - wear.value;
    out.wearAttr = wear.name || String(wear.id);
  }
  const lba = ATTR(rows, "Total_LBAs_Written", 241);
  out.lbasWritten = lba ? lba.raw : null;
  return out;
}

function fromText(text) {
  const grab = (re) => { const m = re.exec(text); return m ? m[1].trim() : null; };
  const nvmeKey = (name) => grab(new RegExp("^\\s*" + name + "\\s*:\\s*(.+)$", "im"));
  const hasNvme = /percentage[ _]used|Available Spare|available_spare|data[ _]units[ _]written/i.test(text);
  if (hasNvme) {
    const smartctl = /SMART\/Health Information \(NVMe Log/i.test(text) || /smartctl/i.test(text);
    const out = { source: smartctl ? "smartctl -a" : "nvme smart-log", kind: "nvme" };
    out.model = grab(/^\s*Model Number:\s*(.+)$/im) || grab(/^\s*Device Model:\s*(.+)$/im);
    const cw = nvmeKey("(?:Critical Warning|critical_warning)");
    out.criticalWarning = cw === null ? null : /^0x/i.test(cw) ? parseInt(cw, 16) : num(cw);
    out.temperature = num(nvmeKey("(?:Temperature|temperature)"));
    out.spare = num(nvmeKey("(?:Available Spare|available_spare)"));
    out.spareThreshold = num(nvmeKey("(?:Available Spare Threshold|available_spare_threshold)"));
    out.percentUsed = num(nvmeKey("(?:Percentage Used|percentage_used)"));
    out.unitsWritten = bigNum(nvmeKey("(?:Data Units Written|data_units_written)"));
    out.unitsRead = bigNum(nvmeKey("(?:Data Units Read|data_units_read)"));
    out.powerCycles = bigNum(nvmeKey("(?:Power Cycles|power_cycles)"));
    out.powerOnHours = bigNum(nvmeKey("(?:Power On Hours|power_on_hours)"));
    out.unsafeShutdowns = bigNum(nvmeKey("(?:Unsafe Shutdowns|unsafe_shutdowns)"));
    out.mediaErrors = bigNum(nvmeKey("(?:Media and Data Integrity Errors|media_errors)"));
    out.errorLogEntries = bigNum(nvmeKey("(?:Error Information Log Entries|num_err_log_entries)"));
    const cap = /Total NVM Capacity:\s*([\d,]+)/i.exec(text) || /Namespace 1 Size\/Capacity:\s*([\d,]+)/i.exec(text);
    out.capacityBytes = cap ? bigNum(cap[1]) : null;
    return out;
  }
  // SATA attribute table from `smartctl -a`: ID# ATTRIBUTE_NAME FLAG VALUE WORST THRESH TYPE UPDATED WHEN_FAILED RAW_VALUE
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(\d{1,3})\s+([A-Za-z][\w-]*)\s+0x[0-9a-f]+\s+(\d{3})\s+(\d{3})\s+(\d{3})\s+\S+\s+\S+\s+\S+\s+(\d+)/i.exec(line);
    if (m) rows.push({ id: Number(m[1]), name: m[2], value: Number(m[3]), worst: Number(m[4]), thresh: Number(m[5]), raw: Number(m[6]) });
  }
  if (rows.length) {
    const out = Object.assign({ source: "smartctl -a" }, sataFromRows(rows));
    out.model = grab(/^\s*Device Model:\s*(.+)$/im);
    return out;
  }
  return null;
}

/* Parse pasted text. Returns an object of numbers (null when a field is absent) or throws Error with a plain message. */
export function parseSmart(raw) {
  const text = String(raw || "").trim();
  if (!text) throw new Error("Paste the output of smartctl -a, smartctl -j or nvme smart-log.");
  let info = null;
  if (text[0] === "{") {
    let j;
    try { j = JSON.parse(text); } catch (e) { throw new Error("That looks like JSON but does not parse: " + e.message); }
    info = fromJson(j);
  } else {
    info = fromText(text);
  }
  if (!info) throw new Error("No SMART health fields found. Paste a full smartctl or nvme smart-log report.");
  for (const field of ["criticalWarning", "temperature", "spare", "spareThreshold", "percentUsed", "unitsWritten", "unitsRead",
    "powerCycles", "powerOnHours", "unsafeShutdowns", "mediaErrors", "errorLogEntries", "reallocated", "pending", "uncorrectable", "lifeLeft", "lbasWritten"]) {
    if (field in info) {
      const value = info[field];
      info[field] = num(field === "criticalWarning" && typeof value === "string" && /^0x[0-9a-f]{1,16}$/i.test(value) ? Number(value) : value);
    }
  }
  if (info.kind === "nvme" && info.percentUsed == null && info.unitsWritten == null && info.spare == null) {
    throw new Error("The NVMe health section is missing. Paste the complete SMART/Health Information block.");
  }
  if (info.kind === "sata" && ![info.percentUsed, info.reallocated, info.pending, info.uncorrectable].some((v) => v != null)) {
    throw new Error("No usable SATA health counters found in the report.");
  }
  info.precisionLimited = Object.values(info).some((v) => typeof v === "number" && v > Number.MAX_SAFE_INTEGER);
  if (info.unitsWritten !== null && info.unitsWritten !== undefined) {
    info.bytesWritten = info.unitsWritten * BYTES_PER_UNIT;
    info.tbWritten = info.bytesWritten / 1e12;
  } else {
    info.bytesWritten = info.tbWritten = null;
  }
  return info;
}

const CRIT_BITS = [
  [0, "available spare is below the threshold", "bad"],
  [1, "temperature is outside the drive's limits", "warn"],
  [2, "reliability is degraded (media or internal errors)", "bad"],
  [3, "the drive has gone read-only", "bad"],
  [4, "the volatile memory backup has failed", "bad"],
  [5, "the persistent memory region is unreliable", "bad"],
];

/* Rate a parsed drive. ratedTbw is the maker's endurance in TB (optional). Returns {level: ok|caution|bad, headline, reasons[], notes[], share, gap}. */
export function assess(info, ratedTbw) {
  const reasons = []; // {level, text}
  const notes = [];
  const add = (level, text) => reasons.push({ level, text });
  let share = null, gap = null;

  if (info.precisionLimited) {
    notes.push("One or more counters exceed JavaScript's exact integer limit (9,007,199,254,740,991). Those counters and calculations based on them are approximate; compare with the original report for exact values.");
  }
  if (info.kind === "nvme" && info.percentUsed == null) {
    notes.push("This report has no valid percentage used, so wear is unknown. The verdict rests on the other counters only.");
  }
  if (info.kind === "nvme") {
    const pu = info.percentUsed;
    if (pu !== null && pu !== undefined) {
      if (pu >= 100) add("bad", `Percentage used is ${pu}%: the drive says it has used up its rated endurance. It can keep working past 100%, but it is past what the maker designed it for.`);
      else if (pu >= 80) add("caution", `Percentage used is ${pu}%: most of the drive's rated endurance is gone. Keep backups and plan a replacement.`);
      else if (pu >= 50) add("ok", `Percentage used is ${pu}%: about half or more of the rated endurance is used, which is normal for an older drive in daily use.`);
      else add("ok", `Percentage used is ${pu}%: plenty of rated endurance left.`);
    }
  }
  if (info.kind === "sata" && info.percentUsed !== undefined && info.percentUsed !== null) {
    add(info.lifeLeft <= 10 ? "bad" : info.lifeLeft <= 30 ? "caution" : "ok",
      `${info.wearAttr} reports ${info.lifeLeft}% life left (about ${info.percentUsed}% of its wear budget used).`);
  }
  if (info.kind === "sata" && info.percentUsed == null) {
    notes.push("This SATA drive does not report a wear attribute we recognise, so wear is unknown. Reallocated and pending sectors below still tell you about its health.");
  }

  if (info.tbWritten !== null && info.tbWritten !== undefined) {
    if (ratedTbw && ratedTbw > 0) {
      share = (info.tbWritten / ratedTbw) * 100;
      if (info.percentUsed !== null && info.percentUsed !== undefined) {
        gap = share - info.percentUsed;
        const g = Math.abs(gap).toFixed(1);
        if (Math.abs(gap) < 5) add("ok", `Host writes are ${share.toFixed(1)}% of the rated ${ratedTbw} TBW, close to the drive's own ${info.percentUsed}%: the two estimates agree.`);
        else if (gap < 0) add("ok", `Host writes are ${share.toFixed(1)}% of the rated ${ratedTbw} TBW but the drive reports ${info.percentUsed}% used, ${g} points more. The drive's figure includes write amplification and its own wear model, so trust the higher one.`);
        else add("ok", `Host writes are ${share.toFixed(1)}% of the rated ${ratedTbw} TBW but the drive reports only ${info.percentUsed}% used, ${g} points less. Makers often rate endurance conservatively, so the drive may last longer than the rating.`);
      } else {
        add("ok", `Host writes are ${share.toFixed(1)}% of the rated ${ratedTbw} TBW.`);
      }
      if (share >= 100) add("bad", `Data written has passed the rated ${ratedTbw} TBW. The warranty is usually over at that point.`);
      else if (share >= 80) add("caution", `Data written is ${share.toFixed(1)}% of the rated ${ratedTbw} TBW.`);
    }
  }

  if (info.spare !== null && info.spare !== undefined && info.spareThreshold !== null && info.spareThreshold !== undefined) {
    if (info.spare <= info.spareThreshold) add("bad", `Available spare is ${info.spare}%, at or below its ${info.spareThreshold}% threshold: the drive is running out of spare blocks.`);
    else if (info.spare < 100) add(info.spare - info.spareThreshold <= 10 ? "caution" : "ok", `Available spare is ${info.spare}% against a ${info.spareThreshold}% threshold: ${info.spare - info.spareThreshold} points of headroom.`);
    else add("ok", `Available spare is ${info.spare}% against a ${info.spareThreshold}% threshold: no spare blocks used yet.`);
  }

  if (info.mediaErrors !== null && info.mediaErrors !== undefined) {
    if (info.mediaErrors > 0) add("caution", `${info.mediaErrors} media and data integrity error${info.mediaErrors === 1 ? "" : "s"} logged: the controller met data it could not read back correctly. A few can be old; a count that keeps growing means failure is near.`);
    else add("ok", "No media or data integrity errors logged.");
  }
  if (info.reallocated != null && info.reallocated > 0) add("caution", `${info.reallocated} reallocated sector${info.reallocated === 1 ? "" : "s"}: the drive has already retired blocks that failed.`);
  if (info.pending != null && info.pending > 0) add("bad", `${info.pending} sector${info.pending === 1 ? "" : "s"} waiting to be reallocated (current pending): data in them may be unreadable.`);
  if (info.uncorrectable != null && info.uncorrectable > 0) add("bad", `${info.uncorrectable} uncorrectable error${info.uncorrectable === 1 ? "" : "s"} reported.`);

  if (info.criticalWarning !== null && info.criticalWarning !== undefined) {
    if (info.criticalWarning === 0) add("ok", "Critical warning flags: none set.");
    else {
      for (const [bit, text, lv] of CRIT_BITS) {
        if (info.criticalWarning & (1 << bit)) add(lv === "bad" ? "bad" : "caution", `Critical warning bit ${bit} is set: ${text}.`);
      }
      if (info.criticalWarning >> 6) add("caution", "Critical warning has a vendor-specific bit set.");
    }
  }

  if (info.unsafeShutdowns !== null && info.unsafeShutdowns !== undefined) {
    const cyc = info.powerCycles;
    const ratio = cyc ? ` out of ${cyc.toLocaleString("en-US")} power cycles` : "";
    notes.push(`${info.unsafeShutdowns.toLocaleString("en-US")} unsafe shutdown${info.unsafeShutdowns === 1 ? "" : "s"}${ratio}: power lost or the machine hard-reset before the drive could flush. A high count is not failure by itself, but it is a sign of rough handling and a small risk to recent writes.`);
  }
  if (info.powerOnHours !== null && info.powerOnHours !== undefined) {
    const d = info.powerOnHours / 24;
    const span = d >= 730 ? `${(d / 365.25).toFixed(1)} years` : d >= 2 ? `${Math.round(d)} days` : `${info.powerOnHours} hours`;
    notes.push(`${info.powerOnHours.toLocaleString("en-US")} power-on hours (${span} of running time).`);
    if (info.powerOnHours < 24 && info.tbWritten !== null && info.tbWritten > 5) notes.push("Very few power-on hours for this much written data. Counters on a used drive can be reset or faked, so treat low numbers on a second-hand drive with some caution.");
  }

  const worst = reasons.some((r) => r.level === "bad") ? "bad" : reasons.some((r) => r.level === "caution") ? "caution" : "ok";
  const headline = worst === "bad" ? "Replace it, or do not buy it" : worst === "caution" ? "Usable, but keep backups and watch it" : info.percentUsed == null ? "No faults found, but wear is unknown" : "Healthy by these numbers";
  // Show problems first, then the rest.
  const order = { bad: 0, caution: 1, ok: 2 };
  reasons.sort((a, b) => order[a.level] - order[b.level]);
  return { level: worst, headline, reasons, notes, share, gap };
}

export const SAMPLES = [
  {
    id: "nvme-new",
    label: "Barely used NVMe (smartctl -a)",
    ratedTbw: 600,
    text: `smartctl 7.4 2023-08-01 r5530 [x86_64-linux-6.1.0-28-amd64] (local build)
Copyright (C) 2002-23, Bruce Allen, Christian Franke, www.smartmontools.org

=== START OF INFORMATION SECTION ===
Model Number:                       Sample NVMe 1TB (example data)
Serial Number:                      EXAMPLE0001
Firmware Version:                   1B2QEXE7
PCI Vendor/Subsystem ID:            0x144d
IEEE OUI Identifier:                0x002538
Total NVM Capacity:                 1,000,204,886,016 [1.00 TB]
Unallocated NVM Capacity:           0
Controller ID:                      4
NVMe Version:                       1.4
Number of Namespaces:               1

=== START OF SMART DATA SECTION ===
SMART overall-health self-assessment test result: PASSED

SMART/Health Information (NVMe Log 0x02)
Critical Warning:                   0x00
Temperature:                        36 Celsius
Available Spare:                    100%
Available Spare Threshold:          10%
Percentage Used:                    2%
Data Units Read:                    4,812,330 [2.46 TB]
Data Units Written:                 2,104,775 [1.08 TB]
Host Read Commands:                 61,420,115
Host Write Commands:                30,118,402
Controller Busy Time:               212
Power Cycles:                       148
Power On Hours:                     1,206
Unsafe Shutdowns:                   9
Media and Data Integrity Errors:    0
Error Information Log Entries:      0
Warning  Comp. Temperature Time:    0
Critical Comp. Temperature Time:    0
`,
  },
  {
    id: "nvme-worn",
    label: "Heavily worn NVMe (nvme smart-log)",
    ratedTbw: 600,
    text: `Smart Log for NVME device:nvme0 namespace-id:ffffffff
critical_warning                        : 0
temperature                             : 47 °C (320 Kelvin)
available_spare                         : 64%
available_spare_threshold               : 10%
percentage_used                         : 112%
endurance_group_critical_warning_summary: 0
data_units_read                         : 903,114,562
data_units_written                      : 1,451,882,309
host_read_commands                      : 12,871,440,093
host_write_commands                     : 21,904,118,720
controller_busy_time                    : 41,205
power_cycles                            : 1,873
power_on_hours                          : 38,914
unsafe_shutdowns                        : 412
media_errors                            : 3
num_err_log_entries                     : 27
Warning Temperature Time                : 215
Critical Composite Temperature Time     : 0
`,
  },
  {
    id: "sata-used",
    label: "Used SATA SSD (smartctl -a)",
    ratedTbw: 0,
    text: `smartctl 7.4 2023-08-01 r5530 [x86_64-linux-6.1.0-28-amd64] (local build)

=== START OF INFORMATION SECTION ===
Device Model:                       Sample SATA SSD 500GB (example data)
Serial Number:                      EXAMPLE0002
User Capacity:                      500,107,862,016 bytes [500 GB]
Rotation Rate:                      Solid State Device

=== START OF SMART DATA SECTION ===
SMART overall-health self-assessment test result: PASSED

SMART Attributes Data Structure revision number: 1
Vendor Specific SMART Attributes with Thresholds:
ID# ATTRIBUTE_NAME          FLAG     VALUE WORST THRESH TYPE      UPDATED  WHEN_FAILED RAW_VALUE
  5 Reallocated_Sector_Ct   0x0033   098   098   010    Pre-fail  Always       -       24
  9 Power_On_Hours          0x0032   081   081   000    Old_age   Always       -       16874
 12 Power_Cycle_Count       0x0032   096   096   000    Old_age   Always       -       3120
177 Wear_Leveling_Count     0x0013   074   074   000    Pre-fail  Always       -       521
179 Used_Rsvd_Blk_Cnt_Tot   0x0013   098   098   010    Pre-fail  Always       -       24
181 Program_Fail_Cnt_Total  0x0032   100   100   010    Old_age   Always       -       0
182 Erase_Fail_Count_Total  0x0032   100   100   010    Old_age   Always       -       0
187 Reported_Uncorrect      0x0032   100   100   000    Old_age   Always       -       0
190 Airflow_Temperature_Cel 0x0032   066   052   000    Old_age   Always       -       34
195 Hardware_ECC_Recovered  0x001a   200   200   000    Old_age   Always       -       0
197 Current_Pending_Sector  0x0032   100   100   000    Old_age   Always       -       0
199 UDMA_CRC_Error_Count    0x003e   100   100   000    Old_age   Always       -       0
235 POR_Recovery_Count      0x0012   099   099   000    Old_age   Always       -       58
241 Total_LBAs_Written      0x0032   099   099   000    Old_age   Always       -       28111872340
`,
  },
];
