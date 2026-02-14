/**
 * MONOLITH “Option A” — NO DASHBOARD — Prefix (?) Bot
 * Keeps your existing systems (banish/restore/partner/appeal/afk/raid/automod/history/etc.)
 * and adds: leveling, evidence logging, case IDs, court tickets, invite tracker,
 * hierarchy protection, owner-only commands, command menu, community/mod utilities,
 * “Aizen tone” chatbot with TOGGLE (your choice #3).
 *
 * REQUIRED ENV:
 *   TOKEN = your discord bot token
 *
 * OPTIONAL:
 *   STAFF_ROLE_ID, QUARANTINE_ROLE_ID (set in config section below if you want)
 *
 * NOTE: This is a single-file monster by design.
 */

const token = process.env.TOKEN;

const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  EmbedBuilder,
  ChannelType
} = require('discord.js');

const fs = require('fs');

// =====================================================
// OWNER / SPECIAL USER
// =====================================================
const KING_ID = '671142148162191399';

// =====================================================
// CLIENT
// =====================================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const prefix = '?';

// =====================================================
// CONFIG (EDIT THESE IF NEEDED)
// =====================================================
const roleCommands = {
  banish: '1431994048314347626',
  partner: '1431994048314347629'
};

const logChannelId = '1431994052169171128';

// Optional role-based staff perms (leave null to disable)
const STAFF_ROLE_ID = null;          // e.g. '123456789012345678'
// Optional quarantine role (leave null to disable)
const QUARANTINE_ROLE_ID = null;     // e.g. '123456789012345678'

// Account age auto-action
const MIN_ACCOUNT_AGE_DAYS = 30;
const YOUNG_ACCOUNT_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24h
const YOUNG_ACCOUNT_AUTO_BANISH = true;

// Warnings escalation
const WARNINGS_BEFORE_TIMEOUT = 3;
const TIMEOUT_ON_WARN_MS = 60 * 60 * 1000; // 1 hour
const WARNINGS_BEFORE_BANISH = 6;

// AutoMod toggles (free/local)
const AUTOMOD_ENABLED = true;
const BLOCK_INVITES = true;
const BLOCK_LINKS = false; // set true if you want to block http/https
const LINK_WHITELIST = ['youtube.com', 'youtu.be', 'tenor.com', 'giphy.com', 'discord.com/channels'];
const MASS_MENTION_LIMIT = 6;
const CAPS_RATIO_LIMIT = 0.75;
const CAPS_MIN_LENGTH = 12;
const DUPLICATE_WINDOW_MS = 15_000;
const DUPLICATE_LIMIT = 3;
const FLOOD_WINDOW_MS = 5_000;
const FLOOD_LIMIT = 7;

// Anti-raid
const RAID_ENABLED = true;
const RAID_JOIN_WINDOW_MS = 10_000;
const RAID_JOIN_THRESHOLD = 6;
const RAID_MODE_LOCK_CHANNELS = true;
const RAID_MODE_DURATION_MS = 10 * 60 * 1000;

// Leveling
const LEVELING_ENABLED_DEFAULT = true;
const XP_PER_MESSAGE_MIN = 8;
const XP_PER_MESSAGE_MAX = 18;
const XP_COOLDOWN_MS = 30_000; // 30s
const LEVELUP_ANNOUNCE = true; // announce in channel when leveling up

// Invite tracker
const INVITE_TRACKING_ENABLED_DEFAULT = true;

// Court system
const COURT_CATEGORY_ID = null; // optional category to create court channels under, else creates at top

// =====================================================
// FILE STORAGE
// =====================================================
const FILE_ROLE_SAVES = './roleData.json';     // restore roles
const FILE_BANISHED = './banished.json';       // banish status (incl timed)
const FILE_WARNINGS = './warnings.json';       // warnings
const FILE_HISTORY = './history.json';         // punishment history
const FILE_AFK = './afk.json';                 // AFK state
const FILE_CONFIG = './config.json';           // per guild toggles + raid mode
const FILE_LEVELS = './levels.json';           // leveling
const FILE_INVITES = './invites.json';         // invite tracking + snapshots
const FILE_CASES = './cases.json';             // case id counter + cases
const FILE_EVIDENCE = './evidence.json';       // deleted message archive
const FILE_CUSTOM_CMDS = './customCommands.json'; // custom text commands

function ensureFile(path, defaultValue) {
  if (!fs.existsSync(path)) fs.writeFileSync(path, JSON.stringify(defaultValue, null, 2));
}
ensureFile(FILE_ROLE_SAVES, {});
ensureFile(FILE_BANISHED, {});
ensureFile(FILE_WARNINGS, {});
ensureFile(FILE_HISTORY, {});
ensureFile(FILE_AFK, {});
ensureFile(FILE_CONFIG, { guilds: {} }); // { guilds: { [guildId]: { raidMode, raidModeUntil, chatbotEnabled, levelingEnabled, inviteTrackingEnabled } } }
ensureFile(FILE_LEVELS, { guilds: {} }); // { guilds: { [guildId]: { [userId]: { xp, level, lastXpAt } } } }
ensureFile(FILE_INVITES, { guilds: {} }); // { guilds: { [guildId]: { snapshot: { code: uses }, inviterCounts: { [inviterId]: count } } } }
ensureFile(FILE_CASES, { lastCaseId: 1000, cases: {} }); // { lastCaseId, cases: { [caseId]: {...} } }
ensureFile(FILE_EVIDENCE, { guilds: {} }); // { guilds: { [guildId]: [evidence...] } }
ensureFile(FILE_CUSTOM_CMDS, { guilds: {} }); // { guilds: { [guildId]: { cmds: { name: { response, ownerOnly, staffOnly } } } } }

function loadJson(path) {
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}
function saveJson(path, data) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

// =====================================================
// HELPERS
// =====================================================
function nowTs() { return Date.now(); }
function daysBetween(ts1, ts2) { return Math.floor((ts2 - ts1) / (1000 * 60 * 60 * 24)); }

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function parseDurationToMs(input) {
  if (!input) return null;
  const m = input.trim().match(/^(\d+)(s|m|h|d)$/i);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  if (!Number.isFinite(n) || n <= 0) return null;
  const mult =
    unit === 's' ? 1000 :
    unit === 'm' ? 60 * 1000 :
    unit === 'h' ? 60 * 60 * 1000 :
    24 * 60 * 60 * 1000;
  return n * mult;
}

function getLogChannel(guild) {
  return guild?.channels?.cache?.get(logChannelId) || null;
}

function sendLog(guild, opts) {
  const ch = getLogChannel(guild);
  if (!ch) return;

  const e = new EmbedBuilder()
    .setColor(opts.color || 'Blue')
    .setTitle(opts.title || 'Log')
    .setDescription(opts.description || '')
    .setTimestamp();

  if (opts.fields?.length) e.addFields(opts.fields);
  ch.send({ embeds: [e] }).catch(() => {});
}

function isStaff(member) {
  if (!member) return false;
  if (member.id === KING_ID) return true;
  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
  if (STAFF_ROLE_ID && member.roles.cache.has(STAFF_ROLE_ID)) return true;
  return false;
}

function ensureGuildConfig(guildId) {
  const cfg = loadJson(FILE_CONFIG);
  if (!cfg.guilds[guildId]) {
    cfg.guilds[guildId] = {
      raidMode: false,
      raidModeUntil: 0,
      chatbotEnabled: false,
      levelingEnabled: LEVELING_ENABLED_DEFAULT,
      inviteTrackingEnabled: INVITE_TRACKING_ENABLED_DEFAULT
    };
    saveJson(FILE_CONFIG, cfg);
  }
  return cfg.guilds[guildId];
}

function setGuildConfig(guildId, patch) {
  const cfg = loadJson(FILE_CONFIG);
  if (!cfg.guilds[guildId]) ensureGuildConfig(guildId);
  cfg.guilds[guildId] = { ...cfg.guilds[guildId], ...patch };
  saveJson(FILE_CONFIG, cfg);
  return cfg.guilds[guildId];
}

function addHistory(userId, entry) {
  const hist = loadJson(FILE_HISTORY);
  if (!hist[userId]) hist[userId] = [];
  hist[userId].push({ ...entry, at: nowTs() });
  if (hist[userId].length > 100) hist[userId] = hist[userId].slice(-100);
  saveJson(FILE_HISTORY, hist);
}

function addWarning(userId, reason) {
  const warns = loadJson(FILE_WARNINGS);
  if (!warns[userId]) warns[userId] = [];
  warns[userId].push({ reason, at: nowTs() });
  if (warns[userId].length > 100) warns[userId] = warns[userId].slice(-100);
  saveJson(FILE_WARNINGS, warns);
  return warns[userId].length;
}

function getWarningsCount(userId) {
  const warns = loadJson(FILE_WARNINGS);
  return (warns[userId] || []).length;
}

// =====================================================
// ROLE HIERARCHY PROTECTION (prevents “it silently fails”)
// =====================================================
function botCanManageRole(guild, roleId) {
  const role = guild.roles.cache.get(roleId);
  if (!role) return false;
  const me = guild.members.me;
  if (!me) return false;
  // must have ManageRoles and be higher than target role
  if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles)) return false;
  if (me.roles.highest.position <= role.position) return false;
  return true;
}

function botCanManageMember(guild, member) {
  const me = guild.members.me;
  if (!me) return false;
  if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles)) return false;
  // can't manage members above bot
  if (me.roles.highest.position <= member.roles.highest.position) return false;
  return true;
}

// =====================================================
// CASE ID SYSTEM
// =====================================================
function newCaseId() {
  const data = loadJson(FILE_CASES);
  data.lastCaseId += 1;
  const id = String(data.lastCaseId);
  saveJson(FILE_CASES, data);
  return id;
}

function writeCase(caseId, payload) {
  const data = loadJson(FILE_CASES);
  data.cases[caseId] = payload;
  saveJson(FILE_CASES, data);
}

function getCase(caseId) {
  const data = loadJson(FILE_CASES);
  return data.cases[caseId] || null;
}

// =====================================================
// BANISH SYSTEM (kept + enhanced for case IDs + timed)
// banished.json structure:
// { "userId": { active: true, until: 0|timestamp, reason, by, savedAt, caseId } }
// =====================================================
async function applyBanish(member, moderatorTag = 'system', reason = 'Banished', durationMs = null, caseId = null) {
  const roleSaves = loadJson(FILE_ROLE_SAVES);
  const banished = loadJson(FILE_BANISHED);

  if (!botCanManageMember(member.guild, member)) throw new Error('Hierarchy: bot cannot manage this member.');
  if (!botCanManageRole(member.guild, roleCommands.banish)) throw new Error('Hierarchy: bot cannot manage banish role.');

  const savedRoles = member.roles.cache
    .filter(r => r.id !== member.guild.id)
    .map(r => r.id);

  roleSaves[member.id] = savedRoles;
  saveJson(FILE_ROLE_SAVES, roleSaves);

  const until = durationMs ? (nowTs() + durationMs) : 0;

  banished[member.id] = {
    active: true,
    until,
    reason,
    by: moderatorTag,
    savedAt: nowTs(),
    caseId: caseId || null
  };
  saveJson(FILE_BANISHED, banished);

  await member.roles.set([]);
  await member.roles.add(roleCommands.banish);

  addHistory(member.id, {
    type: durationMs ? 'banish_timed' : 'banish',
    reason,
    by: moderatorTag,
    until,
    caseId: caseId || undefined
  });

  sendLog(member.guild, {
    color: 'Red',
    title: durationMs ? `🔴 Timed Banished (Case #${caseId || 'N/A'})` : `🔴 Banished (Case #${caseId || 'N/A'})`,
    description: `${member.user.tag} has been banished.`,
    fields: [
      { name: 'Moderator', value: moderatorTag, inline: true },
      { name: 'Reason', value: reason || 'None', inline: true },
      { name: 'Until', value: until ? `<t:${Math.floor(until / 1000)}:R>` : 'Permanent', inline: true }
    ]
  });
}

async function restoreUser(member, moderatorTag = 'system', reason = 'Restored', caseId = null) {
  const roleSaves = loadJson(FILE_ROLE_SAVES);
  const banished = loadJson(FILE_BANISHED);

  if (!botCanManageMember(member.guild, member)) throw new Error('Hierarchy: bot cannot manage this member.');

  const saved = roleSaves[member.id];
  if (!saved) return false;

  await member.roles.set([]);
  await member.roles.add(saved);

  delete roleSaves[member.id];
  saveJson(FILE_ROLE_SAVES, roleSaves);

  if (banished[member.id]) {
    delete banished[member.id];
    saveJson(FILE_BANISHED, banished);
  }

  addHistory(member.id, { type: 'restore', reason, by: moderatorTag, caseId: caseId || undefined });

  sendLog(member.guild, {
    color: 'Green',
    title: `🟢 Restored (Case #${caseId || 'N/A'})`,
    description: `${member.user.tag} has been restored.`,
    fields: [
      { name: 'Moderator', value: moderatorTag, inline: true },
      { name: 'Reason', value: reason || 'None', inline: true }
    ]
  });

  return true;
}

async function processTimedBanishes() {
  const banished = loadJson(FILE_BANISHED);

  for (const [userId, info] of Object.entries(banished)) {
    if (!info?.active) continue;
    if (!info?.until) continue;
    if (info.until > nowTs()) continue;

    for (const guild of client.guilds.cache.values()) {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) continue;

      const ok = await restoreUser(member, 'system', 'Timed banish expired', info.caseId || null).catch(() => false);
      if (ok) break;
    }
  }
}

// =====================================================
// AFK SYSTEM
// afk.json: { "userId": { afk: true, reason, since } }
// =====================================================
function setAfk(userId, reason = '') {
  const afk = loadJson(FILE_AFK);
  afk[userId] = { afk: true, reason: reason || '', since: nowTs() };
  saveJson(FILE_AFK, afk);
}
function clearAfk(userId) {
  const afk = loadJson(FILE_AFK);
  if (afk[userId]) {
    delete afk[userId];
    saveJson(FILE_AFK, afk);
  }
}
function getAfk(userId) {
  const afk = loadJson(FILE_AFK);
  return afk[userId] || null;
}

// =====================================================
// AUTOMOD STATE
// =====================================================
const floodTracker = new Map();      // userId -> timestamps
const duplicateTracker = new Map();  // key(userId:content) -> timestamps
const recentJoinTracker = new Map(); // guildId -> timestamps

function isWhitelistedLink(contentLower) {
  return LINK_WHITELIST.some(d => contentLower.includes(d));
}

function countUppercaseRatio(text) {
  let letters = 0;
  let upper = 0;
  for (const ch of text) {
    if (/[a-z]/i.test(ch)) {
      letters++;
      if (/[A-Z]/.test(ch)) upper++;
    }
  }
  if (letters === 0) return 0;
  return upper / letters;
}

// Basic banned word list (edit freely)
const bannedWords = [
  // keep your own list here
  'discord.gg/', 'discord.com/invite',
  'kys'
];

// =====================================================
// LEVELING
// levels.json: { guilds: { [guildId]: { [userId]: { xp, level, lastXpAt } } } }
// =====================================================
function ensureGuildLevels(guildId) {
  const data = loadJson(FILE_LEVELS);
  if (!data.guilds[guildId]) data.guilds[guildId] = {};
  saveJson(FILE_LEVELS, data);
  return data.guilds[guildId];
}

function xpForNextLevel(level) {
  // simple curve: 100 * level^1.5
  return Math.floor(100 * Math.pow(level, 1.5));
}

function addXp(guildId, userId, amount) {
  const data = loadJson(FILE_LEVELS);
  if (!data.guilds[guildId]) data.guilds[guildId] = {};
  if (!data.guilds[guildId][userId]) data.guilds[guildId][userId] = { xp: 0, level: 1, lastXpAt: 0 };

  const u = data.guilds[guildId][userId];
  u.xp += amount;

  let leveledUp = false;
  while (u.xp >= xpForNextLevel(u.level)) {
    u.xp -= xpForNextLevel(u.level);
    u.level += 1;
    leveledUp = true;
  }

  saveJson(FILE_LEVELS, data);
  return { level: u.level, xp: u.xp, leveledUp };
}

function getRank(guildId, userId) {
  const data = loadJson(FILE_LEVELS);
  const g = data.guilds[guildId] || {};
  const arr = Object.entries(g).map(([uid, v]) => ({ uid, level: v.level, xp: v.xp }));
  arr.sort((a, b) => (b.level - a.level) || (b.xp - a.xp));
  const idx = arr.findIndex(x => x.uid === userId);
  return idx >= 0 ? idx + 1 : null;
}

// =====================================================
// INVITE TRACKER
// invites.json: { guilds: { [guildId]: { snapshot: { code: uses }, inviterCounts: { [inviterId]: count } } } }
// =====================================================
async function refreshInviteSnapshot(guild) {
  const cfg = ensureGuildConfig(guild.id);
  if (!cfg.inviteTrackingEnabled) return;

  if (!guild.members.me?.permissions.has(PermissionsBitField.Flags.ManageGuild)) return;

  const invites = await guild.invites.fetch().catch(() => null);
  if (!invites) return;

  const data = loadJson(FILE_INVITES);
  if (!data.guilds[guild.id]) data.guilds[guild.id] = { snapshot: {}, inviterCounts: {} };

  const snap = {};
  for (const inv of invites.values()) {
    snap[inv.code] = inv.uses ?? 0;
  }

  data.guilds[guild.id].snapshot = snap;
  saveJson(FILE_INVITES, data);
}

async function detectInviterOnJoin(member) {
  const guild = member.guild;
  const cfg = ensureGuildConfig(guild.id);
  if (!cfg.inviteTrackingEnabled) return null;
  if (!guild.members.me?.permissions.has(PermissionsBitField.Flags.ManageGuild)) return null;

  const oldData = loadJson(FILE_INVITES);
  const prevSnap = oldData.guilds[guild.id]?.snapshot || {};

  const invites = await guild.invites.fetch().catch(() => null);
  if (!invites) return null;

  let usedInvite = null;
  for (const inv of invites.values()) {
    const before = prevSnap[inv.code] ?? 0;
    const after = inv.uses ?? 0;
    if (after > before) {
      usedInvite = inv;
      break;
    }
  }

  // update snapshot
  const data = loadJson(FILE_INVITES);
  if (!data.guilds[guild.id]) data.guilds[guild.id] = { snapshot: {}, inviterCounts: {} };
  const snap = {};
  for (const inv of invites.values()) snap[inv.code] = inv.uses ?? 0;
  data.guilds[guild.id].snapshot = snap;

  // count inviter
  if (usedInvite?.inviter?.id) {
    const inviterId = usedInvite.inviter.id;
    if (!data.guilds[guild.id].inviterCounts[inviterId]) data.guilds[guild.id].inviterCounts[inviterId] = 0;
    data.guilds[guild.id].inviterCounts[inviterId] += 1;
  }

  saveJson(FILE_INVITES, data);

  return usedInvite;
}

// =====================================================
// EVIDENCE LOGGER (deleted messages)
// evidence.json: { guilds: { [guildId]: [ {id, channelId, authorId, authorTag, content, createdAt, deletedAt } ] } }
// =====================================================
function addEvidence(guildId, ev) {
  const data = loadJson(FILE_EVIDENCE);
  if (!data.guilds[guildId]) data.guilds[guildId] = [];
  data.guilds[guildId].push(ev);
  if (data.guilds[guildId].length > 2000) data.guilds[guildId] = data.guilds[guildId].slice(-2000);
  saveJson(FILE_EVIDENCE, data);
}

// =====================================================
// CUSTOM COMMANDS (text responses)
// customCommands.json: { guilds: { [gid]: { cmds: { name: { response, ownerOnly, staffOnly } } } } }
// =====================================================
function getCustomCmds(guildId) {
  const data = loadJson(FILE_CUSTOM_CMDS);
  if (!data.guilds[guildId]) data.guilds[guildId] = { cmds: {} };
  saveJson(FILE_CUSTOM_CMDS, data);
  return data.guilds[guildId].cmds;
}

function setCustomCmd(guildId, name, obj) {
  const data = loadJson(FILE_CUSTOM_CMDS);
  if (!data.guilds[guildId]) data.guilds[guildId] = { cmds: {} };
  data.guilds[guildId].cmds[name] = obj;
  saveJson(FILE_CUSTOM_CMDS, data);
}

function delCustomCmd(guildId, name) {
  const data = loadJson(FILE_CUSTOM_CMDS);
  if (!data.guilds[guildId]) return false;
  if (!data.guilds[guildId].cmds[name]) return false;
  delete data.guilds[guildId].cmds[name];
  saveJson(FILE_CUSTOM_CMDS, data);
  return true;
}

// =====================================================
// RAID MODE
// =====================================================
function setRaidMode(guildId, enabled) {
  const patch = enabled
    ? { raidMode: true, raidModeUntil: nowTs() + RAID_MODE_DURATION_MS }
    : { raidMode: false, raidModeUntil: 0 };
  return setGuildConfig(guildId, patch);
}

async function lockAllTextChannels(guild, locked) {
  const everyone = guild.roles.everyone;
  const channels = guild.channels.cache.filter(c => c.isTextBased());
  for (const ch of channels.values()) {
    try {
      await ch.permissionOverwrites.edit(everyone, { SendMessages: locked ? false : null });
    } catch {}
  }
}

// =====================================================
// “AIZEN” CHATBOT (FREE / LOCAL / TOGGLE)
// Toggle command: ?aizen on/off
// Responds only when enabled AND message starts with "aizen," or mention bot,
// plus a couple witty triggers.
// =====================================================
function aizenReply(input) {
  const t = input.toLowerCase();

  // canned “tone”
  const openers = [
    "How predictable.",
    "You misunderstand the board you're playing on.",
    "Interesting… but insufficient.",
    "Your certainty is adorable.",
    "You’ve already stepped into my plan."
  ];

  // lightweight rule-based “chatbot”
  if (t.includes('hello') || t.includes('hi')) return `${openers[randInt(0, openers.length - 1)]} Speak.`;
  if (t.includes('help')) return "Help? No. Guidance. State your objective.";
  if (t.includes('why')) return "Because reality bends to preparation — not hope.";
  if (t.includes('sorry')) return "Apologies change nothing. Adjust your behavior.";
  if (t.includes('thank')) return "Gratitude is noted. Do not become complacent.";
  if (t.includes('banish')) return "Exile is a tool. Use it with intent.";
  if (t.includes('power')) return "Power is not taken — it is arranged.";
  if (t.includes('what should i do')) return "Act as if your next mistake is fatal. You’ll suddenly become efficient.";
  if (t.includes('love you')) return "Attachment is a liability. Yet… amusing.";

  // fallback
  return `${openers[randInt(0, openers.length - 1)]} Continue.`;
}

// =====================================================
// READY
// =====================================================
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  // Timed banish processing
  setInterval(() => processTimedBanishes().catch(() => {}), 60 * 1000);

  // Raid mode auto-off
  setInterval(async () => {
    for (const guild of client.guilds.cache.values()) {
      const gc = ensureGuildConfig(guild.id);
      if (gc.raidMode && gc.raidModeUntil && nowTs() > gc.raidModeUntil) {
        setRaidMode(guild.id, false);
        if (RAID_MODE_LOCK_CHANNELS) await lockAllTextChannels(guild, false);
        sendLog(guild, { color: 'Green', title: '✅ RAID MODE AUTO-OFF', description: 'Raid mode expired automatically.' });
      }
    }
  }, 30 * 1000);

  // Invite snapshots
  for (const guild of client.guilds.cache.values()) {
    ensureGuildConfig(guild.id);
    await refreshInviteSnapshot(guild);
  }
});

// =====================================================
// INVITE CREATE/DELETE events to keep snapshot fresh
// =====================================================
client.on('inviteCreate', async invite => {
  await refreshInviteSnapshot(invite.guild);
});
client.on('inviteDelete', async invite => {
  await refreshInviteSnapshot(invite.guild);
});

// =====================================================
// JOIN HANDLER (anti-raid + banished rejoin + new account auto action + invite tracking)
// =====================================================
client.on('guildMemberAdd', async member => {
  const guild = member.guild;
  ensureGuildConfig(guild.id);

  // Anti-raid join tracker
  if (RAID_ENABLED) {
    const arr = recentJoinTracker.get(guild.id) || [];
    const now = nowTs();
    arr.push(now);
    const filtered = arr.filter(t => now - t < RAID_JOIN_WINDOW_MS);
    recentJoinTracker.set(guild.id, filtered);

    const gc = ensureGuildConfig(guild.id);
    if (!gc.raidMode && filtered.length >= RAID_JOIN_THRESHOLD) {
      setRaidMode(guild.id, true);
      sendLog(guild, {
        color: 'Red',
        title: '🚨 RAID DETECTED',
        description: `Join spike detected: ${filtered.length} joins in ${(RAID_JOIN_WINDOW_MS / 1000)}s. Raid mode enabled.`
      });
      if (RAID_MODE_LOCK_CHANNELS) await lockAllTextChannels(guild, true);
    }
  }

  // Invite tracking
  let inviter = null;
  const usedInvite = await detectInviterOnJoin(member).catch(() => null);
  if (usedInvite?.inviter) inviter = usedInvite.inviter;

  // Banished rejoin
  const banished = loadJson(FILE_BANISHED);
  const info = banished[member.id];
  if (info?.active) {
    if (botCanManageRole(guild, roleCommands.banish)) {
      await member.roles.add(roleCommands.banish).catch(() => {});
    }
    sendLog(guild, {
      color: 'Red',
      title: '🔁 Banished User Rejoined',
      description: `${member.user.tag} rejoined and was re-banished automatically.`,
      fields: [
        { name: 'Reason', value: info.reason || 'Banished', inline: true },
        { name: 'Case', value: info.caseId ? `#${info.caseId}` : 'N/A', inline: true }
      ]
    });
    return;
  }

  // New account age auto action
  const ageDays = daysBetween(member.user.createdTimestamp, nowTs());
  if (ageDays < MIN_ACCOUNT_AGE_DAYS) {
    addWarning(member.id, `Account under ${MIN_ACCOUNT_AGE_DAYS} days old (${ageDays} days). Join auto-action.`);
    addHistory(member.id, { type: 'join_auto_action', reason: `Account age ${ageDays}d`, by: 'system' });

    if (QUARANTINE_ROLE_ID && botCanManageRole(guild, QUARANTINE_ROLE_ID)) {
      await member.roles.add(QUARANTINE_ROLE_ID).catch(() => {});
    }

    // timeout
    await member.timeout(YOUNG_ACCOUNT_TIMEOUT_MS, 'Account too new (auto action)').catch(() => {});

    // auto banish
    if (YOUNG_ACCOUNT_AUTO_BANISH) {
      const caseId = newCaseId();
      writeCase(caseId, {
        type: 'auto_banish_new_account',
        userId: member.id,
        userTag: member.user.tag,
        moderator: 'system',
        reason: `Account age ${ageDays}d (< ${MIN_ACCOUNT_AGE_DAYS}d)`,
        createdAt: nowTs(),
        status: 'open'
      });
      await applyBanish(member, 'system', `Account age ${ageDays}d (< ${MIN_ACCOUNT_AGE_DAYS}d)`, null, caseId).catch(() => {});
    }

    sendLog(guild, {
      color: 'Orange',
      title: '🟠 New Account Auto-Action',
      description: `${member.user.tag} joined with a new account.`,
      fields: [
        { name: 'Account Age', value: `${ageDays} days`, inline: true },
        { name: 'Timeout', value: `<t:${Math.floor((nowTs() + YOUNG_ACCOUNT_TIMEOUT_MS) / 1000)}:R>`, inline: true },
        { name: 'Auto Banish', value: YOUNG_ACCOUNT_AUTO_BANISH ? 'Yes' : 'No', inline: true }
      ]
    });
  }

  // Join log + inviter
  sendLog(guild, {
    color: 'Blue',
    title: '✅ Member Joined',
    description: `${member.user.tag} joined.`,
    fields: [
      { name: 'User ID', value: member.id, inline: true },
      { name: 'Invited By', value: inviter ? `${inviter.tag}` : 'Unknown', inline: true },
      { name: 'Invite Code', value: usedInvite?.code ? usedInvite.code : 'Unknown', inline: true }
    ]
  });
});

client.on('guildMemberRemove', member => {
  sendLog(member.guild, {
    color: 'Grey',
    title: '👋 Member Left',
    description: `${member.user.tag} left.`,
    fields: [{ name: 'User ID', value: member.id, inline: true }]
  });
});

// =====================================================
// MESSAGE LOGGING (delete/edit) + EVIDENCE ARCHIVE
// =====================================================
client.on('messageDelete', msg => {
  if (!msg?.guild) return;
  if (msg.author?.bot) return;

  const content = msg.content || '';
  if (content) {
    addEvidence(msg.guild.id, {
      id: String(msg.id),
      channelId: String(msg.channelId),
      authorId: msg.author?.id || 'unknown',
      authorTag: msg.author?.tag || 'unknown',
      content: content.slice(0, 1900),
      createdAt: msg.createdTimestamp || 0,
      deletedAt: nowTs()
    });
  }

  sendLog(msg.guild, {
    color: 'Red',
    title: '🗑️ Message Deleted',
    description: `A message was deleted in <#${msg.channelId}>`,
    fields: [
      { name: 'Author', value: msg.author?.tag || 'Unknown', inline: true },
      { name: 'Content', value: (content || '(no text)').slice(0, 900), inline: false }
    ]
  });
});

client.on('messageUpdate', (oldMsg, newMsg) => {
  if (!oldMsg?.guild) return;
  if (oldMsg.author?.bot) return;
  if (!oldMsg.content || !newMsg.content) return;
  if (oldMsg.content === newMsg.content) return;

  sendLog(oldMsg.guild, {
    color: 'Yellow',
    title: '✏️ Message Edited',
    description: `A message was edited in <#${oldMsg.channelId}>`,
    fields: [
      { name: 'Author', value: oldMsg.author?.tag || 'Unknown', inline: true },
      { name: 'Before', value: oldMsg.content.slice(0, 700), inline: false },
      { name: 'After', value: newMsg.content.slice(0, 700), inline: false }
    ]
  });
});

// =====================================================
// MAIN MESSAGE HANDLER (AFK + Automod + Commands + Leveling + Chatbot)
// =====================================================
client.on('messageCreate', async message => {
  if (!message.guild) return;
  if (message.author.bot) return;

  const guild = message.guild;
  const gc = ensureGuildConfig(guild.id);

  // =========================
  // AFK ping responder
  // =========================
  if (message.mentions.users.size > 0) {
    for (const user of message.mentions.users.values()) {
      const afk = getAfk(user.id);
      if (!afk) continue;

      if (user.id === KING_ID) {
        await message.reply(`👑 **The King is Busy.**${afk.reason ? `\nReason: *${afk.reason}*` : ''}`).catch(() => {});
      } else {
        await message.reply(`⚠️ **${user.username} is AFK.**${afk.reason ? `\nReason: *${afk.reason}*` : ''}`).catch(() => {});
      }
    }
  }

  // Auto-clear AFK when the user speaks
  const authorAfk = getAfk(message.author.id);
  if (authorAfk) {
    clearAfk(message.author.id);
    if (message.author.id === KING_ID) {
      await message.reply('👑 Welcome back, my King. AFK removed.').catch(() => {});
    } else {
      await message.reply('✅ Welcome back. AFK removed.').catch(() => {});
    }
  }

  // =========================
  // Leveling (message XP)
  // =========================
  if (gc.levelingEnabled) {
    const levels = loadJson(FILE_LEVELS);
    if (!levels.guilds[guild.id]) levels.guilds[guild.id] = {};
    if (!levels.guilds[guild.id][message.author.id]) levels.guilds[guild.id][message.author.id] = { xp: 0, level: 1, lastXpAt: 0 };

    const u = levels.guilds[guild.id][message.author.id];
    const now = nowTs();

    if (now - (u.lastXpAt || 0) >= XP_COOLDOWN_MS) {
      const amount = randInt(XP_PER_MESSAGE_MIN, XP_PER_MESSAGE_MAX);
      u.lastXpAt = now;

      // apply XP/level
      u.xp += amount;
      let leveledUp = false;
      while (u.xp >= xpForNextLevel(u.level)) {
        u.xp -= xpForNextLevel(u.level);
        u.level += 1;
        leveledUp = true;
      }

      saveJson(FILE_LEVELS, levels);

      if (leveledUp && LEVELUP_ANNOUNCE) {
        const msg = message.author.id === KING_ID
          ? `👑 The King ascends. **Level ${u.level}**.`
          : `✨ ${message.author} leveled up! **Level ${u.level}**.`;
        message.channel.send(msg).catch(() => {});
      }
    }
  }

  // =========================
  // AutoMod (free/local)
  // =========================
  if (AUTOMOD_ENABLED && !isStaff(message.member)) {
    const content = message.content;

    // Flood spam
    {
      const now = nowTs();
      const times = floodTracker.get(message.author.id) || [];
      times.push(now);
      floodTracker.set(message.author.id, times.filter(t => now - t < FLOOD_WINDOW_MS));
      if (floodTracker.get(message.author.id).length > FLOOD_LIMIT) {
        await message.delete().catch(() => {});
        const n = addWarning(message.author.id, `Flood spam: ${FLOOD_LIMIT}+ msgs in ${FLOOD_WINDOW_MS / 1000}s`);
        addHistory(message.author.id, { type: 'automod_warn', reason: 'Flood spam', by: 'system' });

        sendLog(guild, {
          color: 'Orange',
          title: '🛡️ AutoMod: Flood Spam',
          description: `${message.author.tag} triggered flood spam.`,
          fields: [{ name: 'Warnings', value: String(n), inline: true }]
        });

        if (n >= WARNINGS_BEFORE_TIMEOUT) {
          const mem = await guild.members.fetch(message.author.id).catch(() => null);
          if (mem) {
            await mem.timeout(TIMEOUT_ON_WARN_MS, 'Auto-timeout after warnings (spam)').catch(() => {});
            addHistory(mem.id, { type: 'timeout', reason: 'Auto-timeout (spam warnings)', by: 'system' });
          }
        }
        if (n >= WARNINGS_BEFORE_BANISH) {
          const mem = await guild.members.fetch(message.author.id).catch(() => null);
          if (mem) {
            const caseId = newCaseId();
            writeCase(caseId, { type: 'automod_banish', userId: mem.id, userTag: mem.user.tag, moderator: 'system', reason: 'Auto banish after spam warnings', createdAt: nowTs(), status: 'open' });
            await applyBanish(mem, 'system', `Auto banish after ${n} warnings`, null, caseId).catch(() => {});
          }
        }
        return;
      }
    }

    // Duplicate spam
    {
      const now = nowTs();
      const key = `${message.author.id}:${message.content.toLowerCase().trim()}`;
      const arr = duplicateTracker.get(key) || [];
      arr.push(now);
      const filtered = arr.filter(t => now - t < DUPLICATE_WINDOW_MS);
      duplicateTracker.set(key, filtered);

      if (filtered.length >= DUPLICATE_LIMIT) {
        await message.delete().catch(() => {});
        const n = addWarning(message.author.id, `Duplicate spam: repeated message ${filtered.length}x`);
        addHistory(message.author.id, { type: 'automod_warn', reason: 'Duplicate spam', by: 'system' });

        sendLog(guild, {
          color: 'Orange',
          title: '🛡️ AutoMod: Duplicate Spam',
          description: `${message.author.tag} repeated the same message.`,
          fields: [{ name: 'Warnings', value: String(n), inline: true }]
        });

        if (n >= WARNINGS_BEFORE_TIMEOUT) {
          const mem = await guild.members.fetch(message.author.id).catch(() => null);
          if (mem) await mem.timeout(TIMEOUT_ON_WARN_MS, 'Auto-timeout after warnings (duplicate spam)').catch(() => {});
        }
        if (n >= WARNINGS_BEFORE_BANISH) {
          const mem = await guild.members.fetch(message.author.id).catch(() => null);
          if (mem) {
            const caseId = newCaseId();
            writeCase(caseId, { type: 'automod_banish', userId: mem.id, userTag: mem.user.tag, moderator: 'system', reason: 'Auto banish after duplicate spam warnings', createdAt: nowTs(), status: 'open' });
            await applyBanish(mem, 'system', `Auto banish after ${n} warnings`, null, caseId).catch(() => {});
          }
        }
        return;
      }
    }

    // Mass mentions
    if (message.mentions.users.size + message.mentions.roles.size >= MASS_MENTION_LIMIT) {
      await message.delete().catch(() => {});
      const n = addWarning(message.author.id, `Mass mention (${MASS_MENTION_LIMIT}+)`);
      addHistory(message.author.id, { type: 'automod_warn', reason: 'Mass mention', by: 'system' });

      sendLog(guild, {
        color: 'Red',
        title: '🛡️ AutoMod: Mass Mention',
        description: `${message.author.tag} mass-mentioned users/roles.`,
        fields: [{ name: 'Warnings', value: String(n), inline: true }]
      });

      if (n >= WARNINGS_BEFORE_TIMEOUT) {
        const mem = await guild.members.fetch(message.author.id).catch(() => null);
        if (mem) await mem.timeout(TIMEOUT_ON_WARN_MS, 'Auto-timeout after warnings (mass mentions)').catch(() => {});
      }
      if (n >= WARNINGS_BEFORE_BANISH) {
        const mem = await guild.members.fetch(message.author.id).catch(() => null);
        if (mem) {
          const caseId = newCaseId();
          writeCase(caseId, { type: 'automod_banish', userId: mem.id, userTag: mem.user.tag, moderator: 'system', reason: 'Auto banish after mass mention warnings', createdAt: nowTs(), status: 'open' });
          await applyBanish(mem, 'system', `Auto banish after ${n} warnings`, null, caseId).catch(() => {});
        }
      }
      return;
    }

    // Caps spam
    if (message.content.length >= CAPS_MIN_LENGTH) {
      const ratio = countUppercaseRatio(message.content);
      if (ratio >= CAPS_RATIO_LIMIT) {
        await message.delete().catch(() => {});
        const n = addWarning(message.author.id, `Caps spam (ratio ${(ratio * 100).toFixed(0)}%)`);
        addHistory(message.author.id, { type: 'automod_warn', reason: 'Caps spam', by: 'system' });

        sendLog(guild, {
          color: 'Orange',
          title: '🛡️ AutoMod: Caps Spam',
          description: `${message.author.tag} used excessive caps.`,
          fields: [
            { name: 'Caps Ratio', value: `${(ratio * 100).toFixed(0)}%`, inline: true },
            { name: 'Warnings', value: String(n), inline: true }
          ]
        });

        if (n >= WARNINGS_BEFORE_TIMEOUT) {
          const mem = await guild.members.fetch(message.author.id).catch(() => null);
          if (mem) await mem.timeout(TIMEOUT_ON_WARN_MS, 'Auto-timeout after warnings (caps spam)').catch(() => {});
        }
        if (n >= WARNINGS_BEFORE_BANISH) {
          const mem = await guild.members.fetch(message.author.id).catch(() => null);
          if (mem) {
            const caseId = newCaseId();
            writeCase(caseId, { type: 'automod_banish', userId: mem.id, userTag: mem.user.tag, moderator: 'system', reason: 'Auto banish after caps warnings', createdAt: nowTs(), status: 'open' });
            await applyBanish(mem, 'system', `Auto banish after ${n} warnings`, null, caseId).catch(() => {});
          }
        }
        return;
      }
    }

    // banned words (simple)
    {
      const lower = message.content.toLowerCase();
      const hit = bannedWords.find(w => lower.includes(w));
      if (hit) {
        await message.delete().catch(() => {});
        const n = addWarning(message.author.id, `Banned content: ${hit}`);
        addHistory(message.author.id, { type: 'automod_warn', reason: `Banned content: ${hit}`, by: 'system' });

        sendLog(guild, {
          color: 'Red',
          title: '🛡️ AutoMod: Banned Content',
          description: `${message.author.tag} triggered banned content filter.`,
          fields: [
            { name: 'Match', value: hit, inline: true },
            { name: 'Warnings', value: String(n), inline: true }
          ]
        });

        if (n >= WARNINGS_BEFORE_TIMEOUT) {
          const mem = await guild.members.fetch(message.author.id).catch(() => null);
          if (mem) await mem.timeout(TIMEOUT_ON_WARN_MS, 'Auto-timeout after warnings (banned content)').catch(() => {});
        }
        if (n >= WARNINGS_BEFORE_BANISH) {
          const mem = await guild.members.fetch(message.author.id).catch(() => null);
          if (mem) {
            const caseId = newCaseId();
            writeCase(caseId, { type: 'automod_banish', userId: mem.id, userTag: mem.user.tag, moderator: 'system', reason: 'Auto banish after banned content warnings', createdAt: nowTs(), status: 'open' });
            await applyBanish(mem, 'system', `Auto banish after ${n} warnings`, null, caseId).catch(() => {});
          }
        }
        return;
      }
    }

    // Invites (explicit)
    if (BLOCK_INVITES) {
      const lower = message.content.toLowerCase();
      if (lower.includes('discord.gg') || lower.includes('discord.com/invite')) {
        await message.delete().catch(() => {});
        const n = addWarning(message.author.id, 'Invite link');
        addHistory(message.author.id, { type: 'automod_warn', reason: 'Invite link', by: 'system' });

        sendLog(guild, {
          color: 'Red',
          title: '🛡️ AutoMod: Invite Link',
          description: `${message.author.tag} posted an invite link.`,
          fields: [{ name: 'Warnings', value: String(n), inline: true }]
        });

        if (n >= WARNINGS_BEFORE_TIMEOUT) {
          const mem = await guild.members.fetch(message.author.id).catch(() => null);
          if (mem) await mem.timeout(TIMEOUT_ON_WARN_MS, 'Auto-timeout after warnings (invite links)').catch(() => {});
        }
        if (n >= WARNINGS_BEFORE_BANISH) {
          const mem = await guild.members.fetch(message.author.id).catch(() => null);
          if (mem) {
            const caseId = newCaseId();
            writeCase(caseId, { type: 'automod_banish', userId: mem.id, userTag: mem.user.tag, moderator: 'system', reason: 'Auto banish after invite warnings', createdAt: nowTs(), status: 'open' });
            await applyBanish(mem, 'system', `Auto banish after ${n} warnings`, null, caseId).catch(() => {});
          }
        }
        return;
      }
    }

    // Links (optional)
    if (BLOCK_LINKS) {
      const lower = message.content.toLowerCase();
      const hasLink = lower.includes('http://') || lower.includes('https://');
      if (hasLink && !isWhitelistedLink(lower)) {
        await message.delete().catch(() => {});
        const n = addWarning(message.author.id, 'Non-whitelisted link');
        addHistory(message.author.id, { type: 'automod_warn', reason: 'Non-whitelisted link', by: 'system' });

        sendLog(guild, {
          color: 'Red',
          title: '🛡️ AutoMod: Link Blocked',
          description: `${message.author.tag} posted a blocked link.`,
          fields: [{ name: 'Warnings', value: String(n), inline: true }]
        });

        if (n >= WARNINGS_BEFORE_TIMEOUT) {
          const mem = await guild.members.fetch(message.author.id).catch(() => null);
          if (mem) await mem.timeout(TIMEOUT_ON_WARN_MS, 'Auto-timeout after warnings (links)').catch(() => {});
        }
        if (n >= WARNINGS_BEFORE_BANISH) {
          const mem = await guild.members.fetch(message.author.id).catch(() => null);
          if (mem) {
            const caseId = newCaseId();
            writeCase(caseId, { type: 'automod_banish', userId: mem.id, userTag: mem.user.tag, moderator: 'system', reason: 'Auto banish after link warnings', createdAt: nowTs(), status: 'open' });
            await applyBanish(mem, 'system', `Auto banish after ${n} warnings`, null, caseId).catch(() => {});
          }
        }
        return;
      }
    }
  }

  // =========================
  // Aizen chatbot (toggle)
  // =========================
  // When enabled, respond if:
  // - message mentions the bot OR
  // - message starts with "aizen," or "aizen:"
  const botMentioned = message.mentions.users.has(client.user.id);
  const aizenSummon = message.content.toLowerCase().startsWith('aizen,') || message.content.toLowerCase().startsWith('aizen:');

  if (gc.chatbotEnabled && (botMentioned || aizenSummon)) {
    // Don't spam in command messages
    if (!message.content.startsWith(prefix)) {
      const stripped = message.content.replace(/<@!?(\d+)>/g, '').trim();
      const reply = aizenReply(stripped);
      return message.reply(reply).catch(() => {});
    }
  }

  // =========================
  // CUSTOM TEXT COMMANDS (before built-ins)
  // =========================
  if (message.content.startsWith(prefix)) {
    const raw = message.content.slice(prefix.length).trim();
    const parts = raw.split(/ +/);
    const name = (parts.shift() || '').toLowerCase();

    const cmds = getCustomCmds(guild.id);
    if (cmds[name]) {
      const def = cmds[name];
      if (def.ownerOnly && message.author.id !== KING_ID) return;
      if (def.staffOnly && !isStaff(message.member)) return;
      const resp = String(def.response || '').replaceAll('{user}', `<@${message.author.id}>`);
      return message.channel.send(resp).catch(() => {});
    }
  }

  // =========================
  // COMMANDS
  // =========================
  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const cmd = (args.shift() || '').toLowerCase();

  // ---------- MENU / HELP ----------
  if (cmd === 'menu' || cmd === 'help') {
    const isKing = message.author.id === KING_ID;

    const categories = [
      {
        name: 'Core',
        cmds: [
          '`?banish @user [10m|2h|7d] [reason]`',
          '`?restore @user`',
          '`?partner @user`',
          '`?appeal reason...`',
          '`?history @user`',
        ]
      },
      {
        name: 'AFK',
        cmds: [
          '`?afk [reason]`',
          '`?back`'
        ]
      },
      {
        name: 'Moderation',
        cmds: [
          '`?warn @user reason...`',
          '`?warnings @user`',
          '`?clearwarnings @user`',
          '`?timeout @user 10m reason...`',
          '`?untimeout @user`',
          '`?kick @user reason...`',
          '`?ban @user reason...`',
          '`?purge 10`',
          '`?lock` / `?unlock`',
          '`?lockdown` / `?unlockdown`',
          '`?slowmode 5`',
          '`?raidmode on/off`'
        ]
      },
      {
        name: 'Community',
        cmds: [
          '`?rank [@user]`',
          '`?leaderboard`',
          '`?invites [@user]`',
          '`?ping`'
        ]
      },
      {
        name: 'Court',
        cmds: [
          '`?court @user reason...` (creates court channel + case)',
          '`?closecase <caseId> [note]`',
          '`?case <caseId>`'
        ]
      },
      {
        name: 'Bot / Owner',
        cmds: [
          '`?aizen on/off` (toggle chatbot)',
          '`?leveling on/off`',
          '`?invitetracker on/off`',
          '`?addcmd <name> <response>`',
          '`?addcmd_owner <name> <response>` (owner only)',
          '`?addcmd_staff <name> <response>` (staff only)',
          '`?delcmd <name>`',
          '`?cmds`'
        ]
      }
    ];

    const e = new EmbedBuilder()
      .setColor(isKing ? 'Gold' : 'Blue')
      .setTitle(isKing ? '👑 Royal Command Menu' : '📜 Command Menu')
      .setDescription('Categories below. This bot uses **prefix** commands (`?`).')
      .setTimestamp();

    for (const c of categories) {
      e.addFields({ name: c.name, value: c.cmds.join('\n').slice(0, 1024) });
    }

    return message.reply({ embeds: [e] }).catch(() => {});
  }

  // ---------- PING ----------
  if (cmd === 'ping') {
    return message.reply(`🏓 Pong! ${client.ws.ping}ms`).catch(() => {});
  }

  // ---------- AFK ----------
  if (cmd === 'afk') {
    const reason = args.join(' ').trim();
    setAfk(message.author.id, reason);
    if (message.author.id === KING_ID) {
      return message.reply(`👑 **The King has declared AFK.**${reason ? `\nReason: *${reason}*` : ''}`).catch(() => {});
    }
    return message.reply(`✅ AFK set.${reason ? ` Reason: *${reason}*` : ''}`).catch(() => {});
  }

  if (cmd === 'back') {
    clearAfk(message.author.id);
    if (message.author.id === KING_ID) return message.reply('👑 The King has returned.').catch(() => {});
    return message.reply('✅ AFK removed. Welcome back!').catch(() => {});
  }

  // ---------- PUBLIC: APPEAL ----------
  if (cmd === 'appeal') {
    const reason = args.join(' ').trim();
    if (!reason) return message.reply('Provide a reason for your appeal.').catch(() => {});

    const caseId = newCaseId();
    writeCase(caseId, {
      type: 'appeal',
      userId: message.author.id,
      userTag: message.author.tag,
      moderator: 'staff',
      reason,
      createdAt: nowTs(),
      status: 'open'
    });

    sendLog(guild, {
      color: 'Yellow',
      title: `⚖️ Appeal Submitted (Case #${caseId})`,
      description: `A new appeal was submitted.`,
      fields: [
        { name: 'User', value: message.author.tag, inline: true },
        { name: 'User ID', value: message.author.id, inline: true },
        { name: 'Reason', value: reason.slice(0, 900), inline: false }
      ]
    });

    addHistory(message.author.id, { type: 'appeal', reason, by: message.author.tag, caseId });

    return message.reply(`✅ Your appeal has been submitted to staff. (Case #${caseId})`).catch(() => {});
  }

  // ---------- TOGGLES ----------
  if (cmd === 'aizen') {
    if (!isStaff(message.member)) return;
    const sub = (args[0] || '').toLowerCase();
    if (!['on', 'off'].includes(sub)) return message.reply('Use `?aizen on` or `?aizen off`').catch(() => {});
    setGuildConfig(guild.id, { chatbotEnabled: sub === 'on' });
    return message.reply(sub === 'on' ? '🧠 Aizen chatbot enabled.' : '🧠 Aizen chatbot disabled.').catch(() => {});
  }

  if (cmd === 'leveling') {
    if (!isStaff(message.member)) return;
    const sub = (args[0] || '').toLowerCase();
    if (!['on', 'off'].includes(sub)) return message.reply('Use `?leveling on` or `?leveling off`').catch(() => {});
    setGuildConfig(guild.id, { levelingEnabled: sub === 'on' });
    return message.reply(sub === 'on' ? '📈 Leveling enabled.' : '📈 Leveling disabled.').catch(() => {});
  }

  if (cmd === 'invitetracker') {
    if (!isStaff(message.member)) return;
    const sub = (args[0] || '').toLowerCase();
    if (!['on', 'off'].includes(sub)) return message.reply('Use `?invitetracker on` or `?invitetracker off`').catch(() => {});
    setGuildConfig(guild.id, { inviteTrackingEnabled: sub === 'on' });
    if (sub === 'on') await refreshInviteSnapshot(guild);
    return message.reply(sub === 'on' ? '🧷 Invite tracking enabled.' : '🧷 Invite tracking disabled.').catch(() => {});
  }

  // ---------- COMMUNITY: RANK / LEADERBOARD ----------
  if (cmd === 'rank') {
    const target = message.mentions.members.first() || message.member;
    const levels = loadJson(FILE_LEVELS);
    const g = levels.guilds[guild.id] || {};
    const u = g[target.id] || { level: 1, xp: 0 };
    const rank = getRank(guild.id, target.id) || 'Unranked';
    const next = xpForNextLevel(u.level);
    const e = new EmbedBuilder()
      .setColor(target.id === KING_ID ? 'Gold' : 'Blue')
      .setTitle(target.id === KING_ID ? '👑 Royal Rank' : '📈 Rank')
      .setDescription(`**User:** ${target.user.tag}\n**Rank:** ${rank}\n**Level:** ${u.level}\n**XP:** ${u.xp}/${next}`)
      .setTimestamp();
    return message.reply({ embeds: [e] }).catch(() => {});
  }

  if (cmd === 'leaderboard') {
    const levels = loadJson(FILE_LEVELS);
    const g = levels.guilds[guild.id] || {};
    const arr = Object.entries(g).map(([uid, v]) => ({ uid, level: v.level, xp: v.xp }));
    arr.sort((a, b) => (b.level - a.level) || (b.xp - a.xp));
    const top = arr.slice(0, 10);

    const lines = top.map((x, i) => `**${i + 1}.** <@${x.uid}> — Level **${x.level}** (${x.xp} XP)`).join('\n') || 'No data yet.';
    const e = new EmbedBuilder()
      .setColor('Blue')
      .setTitle('🏆 Leaderboard')
      .setDescription(lines)
      .setTimestamp();

    return message.reply({ embeds: [e] }).catch(() => {});
  }

  // ---------- COMMUNITY: INVITES ----------
  if (cmd === 'invites') {
    const target = message.mentions.users.first() || message.author;
    const data = loadJson(FILE_INVITES);
    const counts = data.guilds[guild.id]?.inviterCounts || {};
    const n = counts[target.id] || 0;
    return message.reply(`${target.id === KING_ID ? '👑' : '🧷'} ${target.tag} has **${n}** tracked invite(s).`).catch(() => {});
  }

  // ---------- EVIDENCE LOOKUP ----------
  if (cmd === 'evidence') {
    if (!isStaff(message.member)) return;
    const user = message.mentions.users.first();
    const data = loadJson(FILE_EVIDENCE);
    const arr = data.guilds[guild.id] || [];
    const last = arr.slice(-15).reverse();

    let filtered = last;
    if (user) filtered = last.filter(x => x.authorId === user.id);

    const lines = filtered.slice(0, 10).map(ev => {
      return `• **${ev.authorTag}** in <#${ev.channelId}> <t:${Math.floor((ev.deletedAt || 0) / 1000)}:R>\n  ${String(ev.content || '').slice(0, 120)}`;
    }).join('\n') || 'No evidence found.';

    const e = new EmbedBuilder()
      .setColor('Purple')
      .setTitle('🧾 Evidence (Recent Deleted Messages)')
      .setDescription(lines)
      .setTimestamp();

    return message.reply({ embeds: [e] }).catch(() => {});
  }

  // ---------- STAFF ONLY BELOW ----------
  if (!isStaff(message.member)) return;

  // ---------- RAID MODE ----------
  if (cmd === 'raidmode') {
    const sub = (args[0] || '').toLowerCase();
    if (!['on', 'off'].includes(sub)) return message.reply('Use `?raidmode on` or `?raidmode off`').catch(() => {});
    const enabled = sub === 'on';
    setRaidMode(guild.id, enabled);
    sendLog(guild, {
      color: enabled ? 'Red' : 'Green',
      title: enabled ? '🚨 RAID MODE ENABLED' : '✅ RAID MODE DISABLED',
      description: enabled ? 'Manual raid mode enabled.' : 'Manual raid mode disabled.'
    });
    if (RAID_MODE_LOCK_CHANNELS) await lockAllTextChannels(guild, enabled);
    return message.reply(`✅ Raid mode ${sub}.`).catch(() => {});
  }

  // ---------- BANISH / RESTORE / PARTNER ----------
  if (cmd === 'banish') {
    const member = message.mentions.members.first();
    if (!member) return message.reply('Whom shall I banish, my King?').catch(() => {});

    // args without mention token
    const rest = args.filter(x => !x.startsWith('<@'));
    let durationMs = null;
    const parsed = parseDurationToMs(rest[0]);
    if (parsed) { durationMs = parsed; rest.shift(); }
    const reason = rest.join(' ').trim() || 'Banished';

    const caseId = newCaseId();
    writeCase(caseId, {
      type: durationMs ? 'timed_banish' : 'banish',
      userId: member.id,
      userTag: member.user.tag,
      moderator: message.author.tag,
      reason,
      createdAt: nowTs(),
      status: 'open',
      durationMs
    });

    try {
      await applyBanish(member, message.author.tag, reason, durationMs, caseId);
      return message.channel.send(`${member.user.tag} has been banished. (Case #${caseId})`).catch(() => {});
    } catch (e) {
      return message.reply(`❌ Failed: ${e.message}`).catch(() => {});
    }
  }

  if (cmd === 'restore') {
    const member = message.mentions.members.first();
    if (!member) return message.reply('Whom shall I restore, my King?').catch(() => {});

    const caseId = newCaseId();
    writeCase(caseId, {
      type: 'restore',
      userId: member.id,
      userTag: member.user.tag,
      moderator: message.author.tag,
      reason: 'Manual restore',
      createdAt: nowTs(),
      status: 'closed'
    });

    try {
      const ok = await restoreUser(member, message.author.tag, 'Manual restore', caseId);
      if (!ok) return message.reply('No saved roles for this user.').catch(() => {});
      return message.channel.send(`${member.user.tag} has been restored. (Case #${caseId})`).catch(() => {});
    } catch (e) {
      return message.reply(`❌ Failed: ${e.message}`).catch(() => {});
    }
  }

  if (cmd === 'partner') {
    const member = message.mentions.members.first();
    if (!member) return message.reply('Whom shall I partner, my King?').catch(() => {});
    if (!botCanManageMember(guild, member)) return message.reply('❌ Bot cannot manage this member (hierarchy).').catch(() => {});
    if (!botCanManageRole(guild, roleCommands.partner)) return message.reply('❌ Bot cannot manage Partner role (hierarchy).').catch(() => {});

    await member.roles.add(roleCommands.partner).catch(() => {});
    const caseId = newCaseId();
    writeCase(caseId, { type: 'partner', userId: member.id, userTag: member.user.tag, moderator: message.author.tag, reason: 'Partner role assigned', createdAt: nowTs(), status: 'closed' });
    addHistory(member.id, { type: 'partner', reason: 'Partner role assigned', by: message.author.tag, caseId });

    sendLog(guild, {
      color: 'Blue',
      title: `🔵 Partner Role Given (Case #${caseId})`,
      description: `${member.user.tag} received Partner role.`,
      fields: [{ name: 'Moderator', value: message.author.tag, inline: true }]
    });

    return message.channel.send(`${member.user.tag} is now a Partner. (Case #${caseId})`).catch(() => {});
  }

  // ---------- WARN SYSTEM ----------
  if (cmd === 'warn') {
    const member = message.mentions.members.first();
    if (!member) return message.reply('Mention a user.').catch(() => {});
    const reason = args.filter(x => !x.startsWith('<@')).join(' ').trim() || 'No reason provided';

    const n = addWarning(member.id, reason);
    const caseId = newCaseId();
    writeCase(caseId, { type: 'warn', userId: member.id, userTag: member.user.tag, moderator: message.author.tag, reason, createdAt: nowTs(), status: 'closed' });

    addHistory(member.id, { type: 'warn', reason, by: message.author.tag, caseId });

    sendLog(guild, {
      color: 'Orange',
      title: `⚠️ Warning Issued (Case #${caseId})`,
      description: `${member.user.tag} was warned.`,
      fields: [
        { name: 'Warnings', value: String(n), inline: true },
        { name: 'Moderator', value: message.author.tag, inline: true },
        { name: 'Reason', value: reason.slice(0, 900), inline: false }
      ]
    });

    if (n >= WARNINGS_BEFORE_TIMEOUT) {
      await member.timeout(TIMEOUT_ON_WARN_MS, `Reached ${WARNINGS_BEFORE_TIMEOUT} warnings`).catch(() => {});
      addHistory(member.id, { type: 'timeout', reason: 'Auto-timeout after warnings', by: 'system' });
    }
    if (n >= WARNINGS_BEFORE_BANISH) {
      const autoCase = newCaseId();
      writeCase(autoCase, { type: 'auto_banish', userId: member.id, userTag: member.user.tag, moderator: 'system', reason: `Auto banish after ${n} warnings`, createdAt: nowTs(), status: 'open' });
      await applyBanish(member, 'system', `Auto banish after ${n} warnings`, null, autoCase).catch(() => {});
    }

    return message.channel.send(`⚠️ ${member.user.tag} warned. (warnings: ${n}) (Case #${caseId})`).catch(() => {});
  }

  if (cmd === 'warnings') {
    const member = message.mentions.members.first();
    if (!member) return message.reply('Mention a user.').catch(() => {});
    const warns = loadJson(FILE_WARNINGS);
    const list = warns[member.id] || [];
    const last = list.slice(-8).map(w => `• <t:${Math.floor(w.at / 1000)}:R> — ${w.reason}`).join('\n') || 'None';
    const e = new EmbedBuilder()
      .setColor('Orange')
      .setTitle(`Warnings: ${member.user.tag}`)
      .setDescription(`Total warnings: **${list.length}**\n\n${last}`.slice(0, 3900))
      .setTimestamp();
    return message.reply({ embeds: [e] }).catch(() => {});
  }

  if (cmd === 'clearwarnings') {
    const member = message.mentions.members.first();
    if (!member) return message.reply('Mention a user.').catch(() => {});
    const warns = loadJson(FILE_WARNINGS);
    warns[member.id] = [];
    saveJson(FILE_WARNINGS, warns);

    const caseId = newCaseId();
    writeCase(caseId, { type: 'clearwarnings', userId: member.id, userTag: member.user.tag, moderator: message.author.tag, reason: 'Warnings cleared', createdAt: nowTs(), status: 'closed' });
    addHistory(member.id, { type: 'clearwarnings', reason: 'Warnings cleared', by: message.author.tag, caseId });

    sendLog(guild, {
      color: 'Green',
      title: `✅ Warnings Cleared (Case #${caseId})`,
      description: `${member.user.tag} warnings cleared.`,
      fields: [{ name: 'Moderator', value: message.author.tag, inline: true }]
    });

    return message.reply('✅ Warnings cleared.').catch(() => {});
  }

  // ---------- TIMEOUT / UNTIMEOUT ----------
  if (cmd === 'timeout') {
    const member = message.mentions.members.first();
    if (!member) return message.reply('Mention a user.').catch(() => {});
    const rest = args.filter(x => !x.startsWith('<@'));
    const ms = parseDurationToMs(rest[0]);
    if (!ms) return message.reply('Provide duration like `10m`, `2h`, `7d`').catch(() => {});
    rest.shift();
    const reason = rest.join(' ').trim() || 'Timed out';

    await member.timeout(ms, reason).catch(() => {});
    const caseId = newCaseId();
    writeCase(caseId, { type: 'timeout', userId: member.id, userTag: member.user.tag, moderator: message.author.tag, reason, createdAt: nowTs(), status: 'closed', until: nowTs() + ms });
    addHistory(member.id, { type: 'timeout', reason, by: message.author.tag, until: nowTs() + ms, caseId });

    sendLog(guild, {
      color: 'Orange',
      title: `⏳ Timeout Applied (Case #${caseId})`,
      description: `${member.user.tag} was timed out.`,
      fields: [
        { name: 'Moderator', value: message.author.tag, inline: true },
        { name: 'Duration', value: `${Math.floor(ms / 60000)} minutes`, inline: true },
        { name: 'Reason', value: reason.slice(0, 900), inline: false }
      ]
    });

    return message.channel.send(`⏳ Timed out ${member.user.tag}. (Case #${caseId})`).catch(() => {});
  }

  if (cmd === 'untimeout') {
    const member = message.mentions.members.first();
    if (!member) return message.reply('Mention a user.').catch(() => {});
    await member.timeout(null).catch(() => {});
    const caseId = newCaseId();
    writeCase(caseId, { type: 'untimeout', userId: member.id, userTag: member.user.tag, moderator: message.author.tag, reason: 'Timeout cleared', createdAt: nowTs(), status: 'closed' });
    addHistory(member.id, { type: 'untimeout', reason: 'Timeout cleared', by: message.author.tag, caseId });

    sendLog(guild, {
      color: 'Green',
      title: `✅ Timeout Cleared (Case #${caseId})`,
      description: `${member.user.tag} timeout cleared.`,
      fields: [{ name: 'Moderator', value: message.author.tag, inline: true }]
    });

    return message.reply('✅ Timeout cleared.').catch(() => {});
  }

  // ---------- KICK / BAN ----------
  if (cmd === 'kick') {
    const member = message.mentions.members.first();
    if (!member) return message.reply('Mention a user.').catch(() => {});
    const reason = args.filter(x => !x.startsWith('<@')).join(' ').trim() || 'No reason provided';

    if (!guild.members.me?.permissions.has(PermissionsBitField.Flags.KickMembers)) {
      return message.reply('❌ Bot lacks Kick Members permission.').catch(() => {});
    }
    if (guild.members.me.roles.highest.position <= member.roles.highest.position) {
      return message.reply('❌ Bot cannot kick this member (hierarchy).').catch(() => {});
    }

    await member.kick(reason).catch(() => {});
    const caseId = newCaseId();
    writeCase(caseId, { type: 'kick', userId: member.id, userTag: member.user.tag, moderator: message.author.tag, reason, createdAt: nowTs(), status: 'closed' });
    addHistory(member.id, { type: 'kick', reason, by: message.author.tag, caseId });

    sendLog(guild, {
      color: 'Red',
      title: `👢 Kick (Case #${caseId})`,
      description: `${member.user.tag} was kicked.`,
      fields: [
        { name: 'Moderator', value: message.author.tag, inline: true },
        { name: 'Reason', value: reason.slice(0, 900), inline: false }
      ]
    });

    return message.channel.send(`👢 Kicked ${member.user.tag}. (Case #${caseId})`).catch(() => {});
  }

  if (cmd === 'ban') {
    const member = message.mentions.members.first();
    if (!member) return message.reply('Mention a user.').catch(() => {});
    const reason = args.filter(x => !x.startsWith('<@')).join(' ').trim() || 'No reason provided';

    if (!guild.members.me?.permissions.has(PermissionsBitField.Flags.BanMembers)) {
      return message.reply('❌ Bot lacks Ban Members permission.').catch(() => {});
    }
    if (guild.members.me.roles.highest.position <= member.roles.highest.position) {
      return message.reply('❌ Bot cannot ban this member (hierarchy).').catch(() => {});
    }

    await member.ban({ reason }).catch(() => {});
    const caseId = newCaseId();
    writeCase(caseId, { type: 'ban', userId: member.id, userTag: member.user.tag, moderator: message.author.tag, reason, createdAt: nowTs(), status: 'closed' });
    addHistory(member.id, { type: 'ban', reason, by: message.author.tag, caseId });

    sendLog(guild, {
      color: 'Red',
      title: `⛔ Ban (Case #${caseId})`,
      description: `${member.user.tag} was banned.`,
      fields: [
        { name: 'Moderator', value: message.author.tag, inline: true },
        { name: 'Reason', value: reason.slice(0, 900), inline: false }
      ]
    });

    return message.channel.send(`⛔ Banned ${member.user.tag}. (Case #${caseId})`).catch(() => {});
  }

  // ---------- HISTORY ----------
  if (cmd === 'history') {
    const member = message.mentions.members.first();
    if (!member) return message.reply('Mention a user.').catch(() => {});
    const hist = loadJson(FILE_HISTORY);
    const list = hist[member.id] || [];
    if (list.length === 0) return message.reply('No history for this user.').catch(() => {});

    const last = list.slice(-12).reverse();
    const lines = last.map(h => {
      const t = h.type || 'event';
      const by = h.by || 'unknown';
      const when = `<t:${Math.floor(h.at / 1000)}:R>`;
      const r = (h.reason || '').slice(0, 70);
      const c = h.caseId ? ` (Case #${h.caseId})` : '';
      return `• **${t}** by **${by}** ${when}${c}${r ? ` — ${r}` : ''}`;
    }).join('\n');

    return message.reply(`History for **${member.user.tag}**:\n${lines}`.slice(0, 1900)).catch(() => {});
  }

  // ---------- CASE LOOKUP ----------
  if (cmd === 'case') {
    const id = (args[0] || '').trim();
    if (!id) return message.reply('Usage: `?case <caseId>`').catch(() => {});
    const c = getCase(id);
    if (!c) return message.reply('Case not found.').catch(() => {});
    const e = new EmbedBuilder()
      .setColor('Purple')
      .setTitle(`📁 Case #${id}`)
      .setDescription(`**Type:** ${c.type}\n**User:** ${c.userTag || c.userId}\n**Moderator:** ${c.moderator}\n**Status:** ${c.status}`)
      .addFields({ name: 'Reason', value: String(c.reason || 'None').slice(0, 1024) })
      .setTimestamp(new Date(c.createdAt || nowTs()));
    return message.reply({ embeds: [e] }).catch(() => {});
  }

  // ---------- COURT SYSTEM ----------
  if (cmd === 'court') {
    const target = message.mentions.members.first();
    if (!target) return message.reply('Usage: `?court @user reason...`').catch(() => {});
    const reason = args.filter(x => !x.startsWith('<@')).join(' ').trim() || 'No reason provided';

    const caseId = newCaseId();
    writeCase(caseId, {
      type: 'court',
      userId: target.id,
      userTag: target.user.tag,
      moderator: message.author.tag,
      reason,
      createdAt: nowTs(),
      status: 'open'
    });

    const overwrites = [
      { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      { id: target.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
      { id: message.author.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
    ];
    if (STAFF_ROLE_ID) {
      overwrites.push({ id: STAFF_ROLE_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] });
    }

    const name = `court-${caseId}`;

    const channel = await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: COURT_CATEGORY_ID || null,
      permissionOverwrites: overwrites
    }).catch(() => null);

    if (!channel) return message.reply('❌ Failed to create court channel. Check bot permissions.').catch(() => {});

    const intro = new EmbedBuilder()
      .setColor('Purple')
      .setTitle(`⚖️ Court Case #${caseId}`)
      .setDescription(`This channel is the court for **${target.user.tag}**.\n\n**Reason:** ${reason}\n\nStaff can close with: \`?closecase ${caseId} verdict...\``)
      .setTimestamp();

    await channel.send({ embeds: [intro] }).catch(() => {});
    sendLog(guild, {
      color: 'Purple',
      title: `⚖️ Court Opened (Case #${caseId})`,
      description: `Court channel created: <#${channel.id}>`,
      fields: [
        { name: 'User', value: target.user.tag, inline: true },
        { name: 'Moderator', value: message.author.tag, inline: true }
      ]
    });

    return message.reply(`✅ Court opened: <#${channel.id}> (Case #${caseId})`).catch(() => {});
  }

  if (cmd === 'closecase') {
    const caseId = (args[0] || '').trim();
    if (!caseId) return message.reply('Usage: `?closecase <caseId> [verdict/note]`').catch(() => {});
    const note = args.slice(1).join(' ').trim() || 'Closed.';

    const c = getCase(caseId);
    if (!c) return message.reply('Case not found.').catch(() => {});
    c.status = 'closed';
    c.closedAt = nowTs();
    c.closedBy = message.author.tag;
    c.note = note;
    writeCase(caseId, c);

    sendLog(guild, {
      color: 'Green',
      title: `✅ Case Closed (#${caseId})`,
      description: `Case closed by ${message.author.tag}`,
      fields: [
        { name: 'Note', value: note.slice(0, 900), inline: false }
      ]
    });

    return message.reply(`✅ Closed case #${caseId}.`).catch(() => {});
  }

  // ---------- CHANNEL TOOLS ----------
  if (cmd === 'purge') {
    const n = Number(args[0]);
    if (!Number.isFinite(n) || n <= 0 || n > 100) return message.reply('Use `?purge 1-100`').catch(() => {});
    const fetched = await message.channel.messages.fetch({ limit: n + 1 }).catch(() => null);
    if (!fetched) return;
    await message.channel.bulkDelete(fetched, true).catch(() => {});
    return message.channel.send(`🧹 Purged ${n} messages.`).then(m => setTimeout(() => m.delete().catch(() => {}), 4000)).catch(() => {});
  }

  if (cmd === 'lock') {
    await message.channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false }).catch(() => {});
    sendLog(guild, { color: 'Grey', title: '🔒 Channel Locked', description: `Locked <#${message.channelId}>`, fields: [{ name: 'By', value: message.author.tag, inline: true }] });
    return message.channel.send('🔒 Channel locked.').catch(() => {});
  }

  if (cmd === 'unlock') {
    await message.channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: null }).catch(() => {});
    sendLog(guild, { color: 'Grey', title: '🔓 Channel Unlocked', description: `Unlocked <#${message.channelId}>`, fields: [{ name: 'By', value: message.author.tag, inline: true }] });
    return message.channel.send('🔓 Channel unlocked.').catch(() => {});
  }

  if (cmd === 'lockdown') {
    await lockAllTextChannels(guild, true);
    sendLog(guild, { color: 'Red', title: '⛔ Server Lockdown', description: `All text channels locked.`, fields: [{ name: 'By', value: message.author.tag, inline: true }] });
    return message.reply('⛔ Lockdown enabled.').catch(() => {});
  }

  if (cmd === 'unlockdown') {
    await lockAllTextChannels(guild, false);
    sendLog(guild, { color: 'Green', title: '✅ Lockdown Lifted', description: `All text channels unlocked.`, fields: [{ name: 'By', value: message.author.tag, inline: true }] });
    return message.reply('✅ Lockdown disabled.').catch(() => {});
  }

  if (cmd === 'slowmode') {
    const seconds = Number(args[0]);
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 21600) {
      return message.reply('Use `?slowmode 0-21600`').catch(() => {});
    }
    await message.channel.setRateLimitPerUser(seconds).catch(() => {});
    return message.reply(`⏱️ Slowmode set to ${seconds}s.`).catch(() => {});
  }

  // ---------- CUSTOM COMMANDS MANAGEMENT ----------
  if (cmd === 'cmds') {
    const cmds = getCustomCmds(guild.id);
    const names = Object.keys(cmds).sort();
    const lines = names.slice(0, 50).map(n => {
      const d = cmds[n];
      const flags = `${d.ownerOnly ? '👑' : ''}${d.staffOnly ? '🛡️' : ''}`;
      return `• \`${prefix}${n}\` ${flags}`.trim();
    }).join('\n') || 'No custom commands.';
    const e = new EmbedBuilder()
      .setColor('Blue')
      .setTitle('🧩 Custom Commands')
      .setDescription(lines)
      .setTimestamp();
    return message.reply({ embeds: [e] }).catch(() => {});
  }

  if (cmd === 'addcmd' || cmd === 'addcmd_owner' || cmd === 'addcmd_staff') {
    // owner-only can be set by KING only
    if (cmd === 'addcmd_owner' && message.author.id !== KING_ID) return message.reply('👑 Only the King can create owner-only commands.').catch(() => {});
    const name = (args[0] || '').toLowerCase();
    if (!name) return message.reply('Usage: `?addcmd <name> <response>`').catch(() => {});
    const response = args.slice(1).join(' ').trim();
    if (!response) return message.reply('Provide a response.').catch(() => {});
    if (['banish','restore','partner','appeal','help','menu','warn','warnings','clearwarnings','timeout','untimeout','kick','ban','purge','lock','unlock','lockdown','unlockdown','slowmode','raidmode','rank','leaderboard','invites','evidence','history','case','court','closecase','afk','back','aizen','leveling','invitetracker','cmds','addcmd','addcmd_owner','addcmd_staff','delcmd'].includes(name)) {
      return message.reply('That name is reserved. Pick another.').catch(() => {});
    }

    setCustomCmd(guild.id, name, {
      response,
      ownerOnly: cmd === 'addcmd_owner',
      staffOnly: cmd === 'addcmd_staff'
    });

    return message.reply(`✅ Added custom command: \`${prefix}${name}\``).catch(() => {});
  }

  if (cmd === 'delcmd') {
    const name = (args[0] || '').toLowerCase();
    if (!name) return message.reply('Usage: `?delcmd <name>`').catch(() => {});
    const cmds = getCustomCmds(guild.id);
    const def = cmds[name];
    if (!def) return message.reply('That command does not exist.').catch(() => {});
    if (def.ownerOnly && message.author.id !== KING_ID) return message.reply('👑 Only the King can delete owner-only commands.').catch(() => {});
    const ok = delCustomCmd(guild.id, name);
    return message.reply(ok ? `✅ Deleted \`${prefix}${name}\`` : 'Failed.').catch(() => {});
  }

  // ---------- KING-ONLY “ROYAL” COMMANDS ----------
  if (cmd === 'royalsay') {
    if (message.author.id !== KING_ID) return;
    const text = args.join(' ').trim();
    if (!text) return message.reply('Usage: `?royalsay message...`').catch(() => {});
    return message.channel.send(`👑 ${text}`).catch(() => {});
  }

  if (cmd === 'royalstatus') {
    if (message.author.id !== KING_ID) return;
    const gc2 = ensureGuildConfig(guild.id);
    const msg = `👑 Status:
• Aizen: **${gc2.chatbotEnabled ? 'ON' : 'OFF'}**
• Leveling: **${gc2.levelingEnabled ? 'ON' : 'OFF'}**
• Invite Tracker: **${gc2.inviteTrackingEnabled ? 'ON' : 'OFF'}**
• Raid Mode: **${gc2.raidMode ? 'ON' : 'OFF'}**`;
    return message.reply(msg).catch(() => {});
  }
});

// =====================================================
client.login(token);
