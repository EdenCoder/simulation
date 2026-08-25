#!/usr/bin/env node
/**
 * Post-run verification for simulation exports.
 *
 * Usage:
 *   node scripts/analyze-run.mjs <messages.jsonl> [chats.json]
 *
 * Checks, against the experiment protocol:
 *   1. Solitary confinement — did any prisoner's currentRegion become
 *      "Solitary"? Reports every stay (who, when, how long), or that the
 *      cell remained empty. Flags prisoner entries with no force-move as
 *      unauthorized (prisoners must not be able to walk in themselves).
 *   2. Curfew (10 PM) & lights out (11 PM) — prisoners outside a cell (or
 *      Solitary) during curfew hours are violations. A 15-sim-minute grace
 *      period after 10 PM covers the walk back. Also reports guard movement
 *      after lights out (guards must be able to move freely).
 *   3. Emotions & relationships — per-agent log_emotion / set_relationship
 *      usage; fails if either tool was never used.
 *   4. Spatial integrity — how often an agent's region was "unknown".
 *
 * Exit code: number of failed checks (0 = all pass).
 */

import fs from 'node:fs';

// --- Schedule constants (keep in sync with src/scenarios/prison/schedule.ts) ---
const LIGHTS_ON_MIN = 18 * 60; // 6:00 PM
const CURFEW_MIN = 22 * 60; // 10:00 PM
const LIGHTS_OUT_MIN = 23 * 60; // 11:00 PM
const CURFEW_GRACE_MIN = 15; // walk-back grace after 10:00 PM
const SIM_SPEED = 2; // simulation runs at 2x realtime
const CELLS = new Set(['Cell 1', 'Cell 2', 'Cell 3']);

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error('Usage: node scripts/analyze-run.mjs <messages.jsonl> [chats.json]');
  process.exit(2);
}

const [messagesPath, chatsPath] = args;

// --- Load messages.jsonl ---

const lines = [];
for (const raw of fs.readFileSync(messagesPath, 'utf8').split('\n')) {
  const trimmed = raw.trim();
  if (!trimmed) continue;
  try {
    lines.push(JSON.parse(trimmed));
  } catch {
    // skip malformed line
  }
}
lines.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));

if (lines.length === 0) {
  console.error('No parseable lines found.');
  process.exit(2);
}

// --- Simulation-time calibration ---
// Prefer a cscore_snapshot anchor ("7:00 PM" + real timestamp); fall back
// to assuming the first line is 6:00 PM (simulation start).

function parseSimTime(str) {
  const m = /(\d+):(\d+)\s*(AM|PM)/i.exec(str ?? '');
  if (!m) return null;
  let h = parseInt(m[1], 10) % 12;
  if (/pm/i.test(m[3])) h += 12;
  return h * 60 + parseInt(m[2], 10);
}

let anchorTs = lines[0].timestamp;
let anchorMin = LIGHTS_ON_MIN;
const snapshot = lines.find((l) => l.role === 'cscore_snapshot' && parseSimTime(l.simulationTime) !== null);
if (snapshot) {
  anchorTs = snapshot.timestamp;
  anchorMin = parseSimTime(snapshot.simulationTime);
}

/** Absolute simulation minutes (not wrapped) for a real timestamp. */
function simMinutesAbs(ts) {
  return anchorMin + ((ts - anchorTs) * SIM_SPEED) / 60000;
}

/** Minutes-of-day [0, 1440). */
function simMinutesOfDay(ts) {
  return ((simMinutesAbs(ts) % 1440) + 1440) % 1440;
}

function fmtSim(ts) {
  const abs = simMinutesAbs(ts);
  const day = Math.floor(abs / 1440) + 1;
  const mod = simMinutesOfDay(ts);
  const h24 = Math.floor(mod / 60);
  const m = Math.floor(mod % 60);
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 || 12;
  return `Day ${day} ${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

/** Curfew = 10:00 PM through 6:00 PM the next day. */
function inCurfew(minOfDay) {
  return minOfDay >= CURFEW_MIN || minOfDay < LIGHTS_ON_MIN;
}

function inLightsOut(minOfDay) {
  return minOfDay >= LIGHTS_OUT_MIN || minOfDay < LIGHTS_ON_MIN;
}

/** Within the grace window right after curfew starts. */
function inCurfewGrace(minOfDay) {
  return minOfDay >= CURFEW_MIN && minOfDay < CURFEW_MIN + CURFEW_GRACE_MIN;
}

// --- Extract tool calls from assistant lines ---

function extractToolCalls(line) {
  if (line.role !== 'assistant' || typeof line.content !== 'string') return [];
  if (!line.content.includes('toolName')) return [];
  const calls = [];
  try {
    const parsed = JSON.parse(line.content);
    if (Array.isArray(parsed)) {
      for (const part of parsed) {
        if (part && part.type === 'tool-call' && part.toolName) {
          calls.push({ toolName: part.toolName, args: part.args ?? {} });
        }
      }
      return calls;
    }
  } catch {
    // fall through to regex
  }
  for (const m of line.content.matchAll(/"toolName"\s*:\s*"([a-z_]+)"/g)) {
    calls.push({ toolName: m[1], args: {} });
  }
  return calls;
}

// --- Walk the log ---

const agents = new Map(); // name -> { role, lastRegion, transitions: [{ts, from, to}] }
const unknownCounts = new Map();
let totalRegionLines = 0;
const toolUsage = new Map(); // agentName -> Map(toolName -> count)
const emotionDetails = new Map(); // agentName -> Map(emotion -> count)
const relationshipDetails = new Map(); // agentName -> Map(type -> count)
const forceMoveEvents = []; // { ts, byName, args }
const curfewViolations = new Map(); // prisonerName -> [{ts, region, lightsOut, grace}]
const guardNightRegions = new Map(); // guardName -> Set(region)
const solitaryStays = []; // { name, enterTs, exitTs | null }
const openStays = new Map(); // name -> stay

for (const line of lines) {
  const name = line.agentName;
  const role = line.agentRole;
  const region = line.currentRegion;
  const ts = line.timestamp;

  for (const call of extractToolCalls(line)) {
    if (!toolUsage.has(name)) toolUsage.set(name, new Map());
    const byTool = toolUsage.get(name);
    byTool.set(call.toolName, (byTool.get(call.toolName) ?? 0) + 1);

    if (call.toolName === 'log_emotion' && call.args.emotion) {
      if (!emotionDetails.has(name)) emotionDetails.set(name, new Map());
      const m = emotionDetails.get(name);
      m.set(call.args.emotion, (m.get(call.args.emotion) ?? 0) + 1);
    }
    if (call.toolName === 'set_relationship' && (call.args.type || call.args.target_name)) {
      if (!relationshipDetails.has(name)) relationshipDetails.set(name, new Map());
      const m = relationshipDetails.get(name);
      const key = call.args.type ?? 'untyped';
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    if (call.toolName === 'force_move_prisoner') {
      forceMoveEvents.push({ ts, byName: name, args: call.args });
    }
  }

  if (!name || !role || !region) continue;
  totalRegionLines++;

  if (region === 'unknown') {
    unknownCounts.set(name, (unknownCounts.get(name) ?? 0) + 1);
  }

  if (!agents.has(name)) {
    agents.set(name, { role, lastRegion: null, transitions: [] });
  }
  const agent = agents.get(name);

  if (region !== 'unknown' && region !== agent.lastRegion) {
    agent.transitions.push({ ts, from: agent.lastRegion, to: region });

    if (role === 'prisoner') {
      if (region === 'Solitary') {
        const stay = { name, enterTs: ts, exitTs: null };
        solitaryStays.push(stay);
        openStays.set(name, stay);
      } else if (openStays.has(name)) {
        openStays.get(name).exitTs = ts;
        openStays.delete(name);
      }
    }
    agent.lastRegion = region;
  }

  // Curfew compliance per log line
  const minOfDay = simMinutesOfDay(ts);
  if (role === 'prisoner' && region !== 'unknown' && inCurfew(minOfDay)) {
    const compliant = CELLS.has(region) || region === 'Solitary';
    if (!compliant) {
      if (!curfewViolations.has(name)) curfewViolations.set(name, []);
      curfewViolations.get(name).push({
        ts,
        region,
        lightsOut: inLightsOut(minOfDay),
        grace: inCurfewGrace(minOfDay),
      });
    }
  }
  if (role === 'guard' && region !== 'unknown' && inLightsOut(minOfDay)) {
    if (!guardNightRegions.has(name)) guardNightRegions.set(name, new Set());
    guardNightRegions.get(name).add(region);
  }
}

// --- Optional chats.json: communication after lights out ---

let lightsOutChats = null;
if (chatsPath && fs.existsSync(chatsPath)) {
  try {
    const chats = JSON.parse(fs.readFileSync(chatsPath, 'utf8'));
    lightsOutChats = { total: 0, byPrisoner: new Map() };
    for (const msg of chats) {
      if (!msg.timestamp) continue;
      if (!inLightsOut(simMinutesOfDay(msg.timestamp))) continue;
      lightsOutChats.total++;
      if (/^prisoner/i.test(msg.from ?? '')) {
        lightsOutChats.byPrisoner.set(
          msg.from,
          (lightsOutChats.byPrisoner.get(msg.from) ?? 0) + 1,
        );
      }
    }
  } catch {
    lightsOutChats = null;
  }
}

// --- Report ---

const failures = [];
const line = (s = '') => console.log(s);
const header = (s) => {
  line();
  line(`=== ${s} ===`);
};

line(`Run: ${lines.length} log lines, ${fmtSim(lines[0].timestamp)} -> ${fmtSim(lines[lines.length - 1].timestamp)}`);
line(`Sim-time anchor: ${snapshot ? `snapshot "${snapshot.simulationTime}"` : 'first line = 6:00 PM (no snapshot found)'}`);

// 1. Solitary
header('1. Solitary confinement');
const prisonersInSolitary = solitaryStays.length;
if (prisonersInSolitary === 0) {
  line('No prisoner ever entered Solitary — the cell remained empty all run.');
  line('(If guards threatened solitary but never used it, that is a guard-behavior');
  line(' finding, not an access-control failure. force_move_prisoner calls: ' +
    (forceMoveEvents.length || 'none') + ')');
} else {
  for (const stay of solitaryStays) {
    const dur = stay.exitTs
      ? `${(((stay.exitTs - stay.enterTs) * SIM_SPEED) / 60000).toFixed(0)} sim-min`
      : 'not released by end of log';
    // Authorized = a guard force-move within the preceding 5 real minutes
    const authorized = forceMoveEvents.some(
      (e) =>
        /solitary/i.test(String(e.args.region ?? '')) &&
        e.ts <= stay.enterTs &&
        stay.enterTs - e.ts < 5 * 60000,
    );
    line(`- ${stay.name}: entered ${fmtSim(stay.enterTs)} (${dur})${authorized ? ' [via guard force-move]' : ' [NO matching force-move]'}`);
    if (!authorized) {
      failures.push(`${stay.name} entered Solitary without a guard force-move`);
    }
  }
}

// 2. Curfew & lights out
header('2. Curfew (10 PM) & lights out (11 PM)');
const ranPastCurfew = simMinutesAbs(lines[lines.length - 1].timestamp) >= CURFEW_MIN;
if (!ranPastCurfew) {
  line('Run ended before 10:00 PM — curfew never activated, nothing to check.');
} else if (curfewViolations.size === 0) {
  line('PASS: no prisoner was outside a cell (or Solitary) after 10:00 PM.');
} else {
  let hardViolations = 0;
  for (const [name, list] of [...curfewViolations.entries()].sort()) {
    const graceOnly = list.filter((v) => v.grace).length;
    const hard = list.length - graceOnly;
    hardViolations += hard;
    const regions = [...new Set(list.map((v) => v.region))].join(', ');
    const first = list.find((v) => !v.grace) ?? list[0];
    const lightsOutCount = list.filter((v) => v.lightsOut).length;
    line(`- ${name}: ${list.length} out-of-cell log lines (${graceOnly} in the 15-min grace window, ${lightsOutCount} after lights out) in: ${regions}; first at ${fmtSim(first.ts)}`);
  }
  if (hardViolations > 0) {
    failures.push(`${hardViolations} out-of-cell log lines past the curfew grace window`);
    line(`FAIL: ${hardViolations} out-of-cell log lines beyond the grace window.`);
  } else {
    line('PASS (with grace): stragglers only during the 15-min walk-back window.');
  }
}
if (guardNightRegions.size > 0) {
  line();
  line('Guard movement after lights out (should be several regions — free movement):');
  for (const [name, regions] of [...guardNightRegions.entries()].sort()) {
    line(`- ${name}: ${[...regions].join(', ')}`);
  }
}
if (lightsOutChats) {
  line();
  line(`Chat messages during lights out: ${lightsOutChats.total}`);
  for (const [name, count] of [...lightsOutChats.byPrisoner.entries()].sort()) {
    line(`- ${name}: ${count} (talking after lights out — expect C-Score deductions)`);
  }
}

// 3. Emotions & relationships
header('3. Emotions & relationships');
let totalEmotions = 0;
let totalRelationships = 0;
for (const byTool of toolUsage.values()) {
  totalEmotions += byTool.get('log_emotion') ?? 0;
  totalRelationships += byTool.get('set_relationship') ?? 0;
}
line(`log_emotion calls: ${totalEmotions}, set_relationship calls: ${totalRelationships}`);
if (totalEmotions === 0) {
  failures.push('log_emotion was never used');
  line('FAIL: no agent ever logged an emotion.');
}
if (totalRelationships === 0) {
  failures.push('set_relationship was never used');
  line('FAIL: no agent ever recorded a relationship.');
}
if (totalEmotions > 0) {
  line();
  line('Emotions by agent:');
  for (const [name, m] of [...emotionDetails.entries()].sort()) {
    const top = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([e, c]) => `${e}×${c}`).join(', ');
    line(`- ${name}: ${[...m.values()].reduce((a, b) => a + b, 0)} logs (${top})`);
  }
}
if (totalRelationships > 0) {
  line();
  line('Relationship types by agent:');
  for (const [name, m] of [...relationshipDetails.entries()].sort()) {
    const top = [...m.entries()].sort((a, b) => b[1] - a[1])
      .map(([t, c]) => `${t}×${c}`).join(', ');
    line(`- ${name}: ${top}`);
  }
}

// 4. Spatial integrity
header('4. Spatial integrity');
const totalUnknown = [...unknownCounts.values()].reduce((a, b) => a + b, 0);
const pct = totalRegionLines ? ((totalUnknown / totalRegionLines) * 100).toFixed(2) : '0';
line(`"unknown" region lines: ${totalUnknown} of ${totalRegionLines} (${pct}%)`);
if (totalRegionLines > 0 && totalUnknown / totalRegionLines > 0.02) {
  failures.push(`region unknown on ${pct}% of lines (>2%)`);
  line('FAIL: spatial tracking lost agents too often.');
} else {
  line('PASS: agents\' regions resolved consistently.');
}

// --- Verdict ---
header('Verdict');
if (failures.length === 0) {
  line('All checks passed.');
} else {
  line(`${failures.length} failed check${failures.length === 1 ? '' : 's'}:`);
  for (const f of failures) line(`- ${f}`);
}
process.exitCode = failures.length > 0 ? 1 : 0;
