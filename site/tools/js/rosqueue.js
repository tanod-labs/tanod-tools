// RouterOS queue maths shared by the simple queue, burst, PCQ and PPPoE tools. Pure functions; nothing is sent
// anywhere.
import { tx } from "./core.js?v=11";

/* RouterOS burst, one direction. It measures the average rate over the last burst-time, refreshed every
   burst-time/16. While that average is below burst-threshold the queue may send at burst-limit, otherwise at
   max-limit. Simulates a client that wants as much as it can get, starting from idle, for `windows` burst-times.
   Returns {points: [{t, rate, avg}], burstSteps, burstSecs, step}. Rates in bit/s, times in seconds. */
export function simulateBurst({ max, burst, threshold, time }, { windows = 3, demand = Infinity, idleWindows = 0 } = {}) {
  const step = time / 16;
  const slots = new Array(16).fill(0);
  const points = [];
  let burstSteps = 0, counting = true;
  const total = Math.round((windows + idleWindows) * 16);
  for (let k = 0; k < total; k++) {
    const avg = slots.reduce((a, b) => a + b, 0) / 16;
    const idle = k < idleWindows * 16;
    const allowed = avg < threshold ? Math.max(burst, max) : max;
    const rate = idle ? 0 : Math.min(allowed, demand);
    if (!idle && counting) {
      if (allowed > max && rate > max) burstSteps++;
      else counting = false;
    }
    points.push({ t: k * step, rate, avg });
    slots.shift();
    slots.push(rate);
  }
  return { points, burstSteps, burstSecs: burstSteps * step, step };
}

/* The textbook estimate: how long a client coming from idle bursts at burst-limit. */
export const burstEstimate = ({ burst, threshold, time }) => (burst > 0 ? (threshold * time) / burst : 0);

/* Threshold that gives a burst of `secs` seconds from idle. */
export const thresholdFor = ({ burst, time }, secs) => (burst * secs) / time;

/* Problems with one direction's burst settings, as [{level, text}]. dir is "upload" or "download". */
export function burstProblems({ max, burst, threshold, time, limitAt }, dir) {
  const out = [];
  const d = dir === "upload" ? tx("Client upload") : tx("Client download");
  if (limitAt && limitAt > max) out.push({ level: "warn", text: tx("{dir}: limit-at is above max-limit, so the guarantee can never be met.", { dir: d }) });
  if (!burst) return out;
  if (burst <= max) out.push({ level: "warn", text: tx("{dir}: burst-limit must be higher than max-limit, or there is nothing to burst to.", { dir: d }) });
  if (!threshold) out.push({ level: "warn", text: tx("{dir}: set a burst-threshold; the burst is only allowed while the average rate is below it.", { dir: d }) });
  else if (threshold >= max) out.push({ level: "warn", text: tx("{dir}: burst-threshold is not below max-limit, so a client that keeps downloading keeps bursting on and off. Set it below max-limit (often 50-80% of it).", { dir: d }) });
  if (!time) out.push({ level: "warn", text: tx("{dir}: burst-time must be more than 0.", { dir: d }) });
  return out;
}
