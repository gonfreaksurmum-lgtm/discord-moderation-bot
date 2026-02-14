const token = process.env.TOKEN;

const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  EmbedBuilder
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

// Optional (leave null to disable role-based staff permissions)
const STAFF_ROLE_ID = null; // e.g. '123456789012345678'

// Optional quarantine role for raid/new accounts (leave null to disable)
const QUARANTINE_ROLE_ID = null; // e.g. '123...'

// Account age rule
const MIN_ACCOUNT_AGE_DAYS = 30;

// Warnings escalation
const WARNINGS_BEFORE_TIMEOUT = 3;
const TIMEOUT_ON_WARN_MS = 60 * 60 * 1000; // 1 hour
const WARNINGS_BEFORE_BANISH = 6; // after this many warnings → auto banish

// New account join actions
const YOUNG_ACCOUNT_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24h
const YOUNG_ACCOUNT_AUTO_BANISH = true; // if false, only timeout/quarantine

// AutoMod toggles
const AUTOMOD_ENABLED = true;
const BLOCK_INVITES = true;
const BLOCK_LINKS = false; // set true if you want to block http/https too
const LINK_WHITELIST = ['youtube.com', 'youtu.be', 'tenor.com', 'giphy.com']; // allowed domains if BLOCK_LINKS
const MASS_MENTION_LIMIT = 6; // mentions in one message
const CAPS_RATIO_LIMIT = 0.75; // caps ratio threshold
const CAPS_MIN_LENGTH = 12; // only check caps if message length >= this
const DUPLICATE_WINDOW_MS = 15_000; // 15 seconds
const DUPLICATE_LIMIT = 3; // same message repeated this many times in window
const FLOOD_WINDOW_MS = 5_000; // 5 seconds
const FLOOD_LIMIT = 7; // messages in window

// Anti-raid
const RAID_ENABLED = true;
const RAID_JOIN_WINDOW_MS = 10_000; // 10 seconds
const RAID_JOIN_THRESHOLD = 6; // joins in window triggers raid mode
const RAID_MODE_LOCK_CHANNELS = true; // lock text channels on raid mode
const RAID_MODE_DURATION_MS = 10 * 60 * 1000; // 10 minutes, then auto-off

// =====================================================
// FILE STORAGE
// =====================================================
const FILE_ROLE_SAVES = './roleData.json';
const FILE_BANISHED = './banished.json';
const FILE_WARNINGS = './warnings.json';
const FILE_HISTORY = './history.json';
const FILE_AFK = './afk.json';
const FILE_CONFIG = './config.json';

function ensureFile(path, defaultValue) {
  if (!fs.existsSync(path)) fs.writeFileSync(path, JSON.stringify(defaultValue, null, 2));
}
ensureFile(FILE_ROLE_SAVES, {});
ensureFile(FILE_BANISHED, {});
ensureFile(FILE_WARNINGS, {});
ensureFile(FILE_HISTORY, {});
ensureFile(FILE_AFK, {});
ensureFile(FILE_CONFIG, { raidMode: false, raidModeUntil: 0 });

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
function daysBetween(ts1, ts2) {
  return Math.floor((ts2 - ts1) / (1000 * 60 * 60 * 24));
}

function parseDurationToMs(input) {
  // supports: 10s, 5m, 2h, 7d
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

function addHistory(userId, entry) {
  const hist = loadJson(FILE_HISTORY);
  if (!hist[userId]) hist[userId] = [];
  hist[userId].push({ ...entry, at: nowTs() });
  if (hist[userId].length > 80) hist[userId] = hist[userId].slice(-80);
  saveJson(FILE_HISTORY, hist);
}

function addWarning(userId, reason) {
  const warns = loadJson(FILE_WARNINGS);
  if (!warns[userId]) warns[userId] = [];
  warns[userId].push({ reason, at: nowTs() });
  if (warns[userId].length > 80) warns[userId] = warns[userId].slice(-80);
  saveJson(FILE_WARNINGS, warns);
  return warns[userId].length;
}

function getWarningsCount(userId) {
  const warns = loadJson(FILE_WARNINGS);
  return (warns[userId] || []).length;
}

function setRaidMode(guild, enabled) {
  const cfg = loadJson(FILE_CONFIG);
  cfg.raidMode = enabled;
  cfg.raidModeUntil = enabled ? (nowTs() + RAID_MODE_DURATION_MS) : 0;
  saveJson(FILE_CONFIG, cfg);

  sendLog(guild, {
    color: enabled ? 'Red' : 'Green',
    title: enabled ? '🚨 RAID MODE ENABLED' : '✅ RAID MODE DISABLED',
    description: enabled
      ? `Raid mode active for ${Math.floor(RAID_MODE_DURATION_MS / 60000)} minutes.`
      : 'Raid mode has been turned off.'
  });
}

async function lockAllTextChannels(guild, locked) {
  const everyone = guild.roles.everyone;
  const channels = guild.channels.cache.filter(c => c.isTextBased());
  for (const ch of channels.values()) {
    try {
      await ch.permissionOverwrites.edit(everyone, {
        SendMessages: locked ? false : null
      });
    } catch {}
  }
}

// =====================================================
// BANISH SYSTEM (keeps your existing behavior + timed banish)
// banished.json structure:
// { "userId": { active: true, until: 0|timestamp, reason, by, savedAt } }
// =====================================================
async function applyBanish(member, moderatorTag = 'system', reason = 'Banished', durationMs = null) {
  const roleSaves = loadJson(FILE_ROLE_SAVES);
  const banished = loadJson(FILE_BANISHED);

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
    savedAt: nowTs()
  };
  saveJson(FILE_BANISHED, banished);

  await member.roles.set([]);
  await member.roles.add(roleCommands.banish);

  addHistory(member.id, {
    type: durationMs ? 'banish_timed' : 'banish',
    reason,
    by: moderatorTag,
    until
  });

  sendLog(member.guild, {
    color: 'Red',
    title: durationMs ? '🔴 User Timed-Banished' : '🔴 User Banished',
    description: `${member.user.tag} has been banished.`,
    fields: [
      { name: 'Moderator', value: moderatorTag, inline: true },
      { name: 'Reason', value: reason || 'None', inline: true },
      { name: 'Until', value: until ? `<t:${Math.floor(until / 1000)}:R>` : 'Permanent', inline: true }
    ]
  });
}

async function restoreUser(member, moderatorTag = 'system', reason = 'Restored') {
  const roleSaves = loadJson(FILE_ROLE_SAVES);
  const banished = loadJson(FILE_BANISHED);

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

  addHistory(member.id, { type: 'restore', reason, by: moderatorTag });

  sendLog(member.guild, {
    color: 'Green',
    title: '🟢 User Restored',
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
    if (!info?.until) continue; // permanent
    if (info.until > nowTs()) continue;

    // expired → try restore in any guild the bot is in
    for (const guild of client.guilds.cache.values()) {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) continue;

      const ok = await restoreUser(member, 'system', 'Timed banish expired');
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
const spamTracker = new Map(); // flood
const duplicateTracker = new Map(); // duplicate content
const recentJoinTracker = new Map(); // guildId -> timestamps

function isWhitelistedLink(content) {
  const lower = content.toLowerCase();
  return LINK_WHITELIST.some(d => lower.includes(d));
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

// =====================================================
// READY
// =====================================================
client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  // timed banish processing
  setInterval(() => processTimedBanishes().catch(() => {}), 60 * 1000);

  // raid mode auto-off
  setInterval(async () => {
    const cfg = loadJson(FILE_CONFIG);
    if (cfg.raidMode && cfg.raidModeUntil && nowTs() > cfg.raidModeUntil) {
      cfg.raidMode = false;
      cfg.raidModeUntil = 0;
      saveJson(FILE_CONFIG, cfg);

      for (const guild of client.guilds.cache.values()) {
        if (RAID_MODE_LOCK_CHANNELS) await lockAllTextChannels(guild, false);
        sendLog(guild, { color: 'Green', title: '✅ RAID MODE AUTO-OFF', description: 'Raid mode expired automatically.' });
      }
    }
  }, 30 * 1000);
});

// =====================================================
// JOIN HANDLER (new account auto action + anti-raid)
// =====================================================
client.on('guildMemberAdd', async member => {
  try {
    const guild = member.guild;

    // Anti-raid join tracker
    if (RAID_ENABLED) {
      const arr = recentJoinTracker.get(guild.id) || [];
      const now = nowTs();
      arr.push(now);
      const filtered = arr.filter(t => now - t < RAID_JOIN_WINDOW_MS);
      recentJoinTracker.set(guild.id, filtered);

      const cfg = loadJson(FILE_CONFIG);

      if (!cfg.raidMode && filtered.length >= RAID_JOIN_THRESHOLD) {
        setRaidMode(guild, true);
        if (RAID_MODE_LOCK_CHANNELS) await lockAllTextChannels(guild, true);
      }
    }

    // If already banished in db → re-apply banish role on rejoin
    const banished = loadJson(FILE_BANISHED);
    const info = banished[member.id];
    if (info?.active) {
      await member.roles.add(roleCommands.banish).catch(() => {});
      sendLog(guild, {
        color: 'Red',
        title: '🔁 Banished User Rejoined',
        description: `${member.user.tag} rejoined and was re-banished automatically.`,
        fields: [{ name: 'Reason', value: info.reason || 'Banished' }]
      });
      return;
    }

    // Account age check
    const ageDays = daysBetween(member.user.createdTimestamp, nowTs());
    if (ageDays < MIN_ACCOUNT_AGE_DAYS) {
      addWarning(member.id, `Account under ${MIN_ACCOUNT_AGE_DAYS} days old (${ageDays} days). Join auto-action.`);
      addHistory(member.id, { type: 'join_auto_action', reason: `Account age ${ageDays} days`, by: 'system' });

      // Optional quarantine
      if (QUARANTINE_ROLE_ID) await member.roles.add(QUARANTINE_ROLE_ID).catch(() => {});

      // Timeout (Moderate Members needed)
      await member.timeout(YOUNG_ACCOUNT_TIMEOUT_MS, 'Account too new (auto action)').catch(() => {});

      // Optional banish role
      if (YOUNG_ACCOUNT_AUTO_BANISH) {
        await applyBanish(member, 'system', `Account age ${ageDays}d (< ${MIN_ACCOUNT_AGE_DAYS}d)`, null);
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

    // Log join
    sendLog(guild, {
      color: 'Blue',
      title: '✅ Member Joined',
      description: `${member.user.tag} joined.`,
      fields: [{ name: 'User ID', value: member.id, inline: true }]
    });

  } catch (e) {
    console.error('guildMemberAdd error:', e);
  }
});

client.on('guildMemberRemove', member => {
  try {
    sendLog(member.guild, {
      color: 'Grey',
      title: '👋 Member Left',
      description: `${member.user.tag} left.`,
      fields: [{ name: 'User ID', value: member.id, inline: true }]
    });
  } catch {}
});

// =====================================================
// MESSAGE LOGGING (delete/edit)
// =====================================================
client.on('messageDelete', msg => {
  if (!msg?.guild || !msg.content) return;
  if (msg.author?.bot) return;

  sendLog(msg.guild, {
    color: 'Red',
    title: '🗑️ Message Deleted',
    description: `A message was deleted in <#${msg.channelId}>`,
    fields: [
      { name: 'Author', value: msg.author?.tag || 'Unknown', inline: true },
      { name: 'Content', value: msg.content.slice(0, 900) || '(empty)', inline: false }
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
// MAIN MESSAGE HANDLER (AFK + Automod + Commands)
// =====================================================
client.on('messageCreate', async message => {
  if (!message.guild) return;
  if (message.author.bot) return;

  const guild = message.guild;
  const cfg = loadJson(FILE_CONFIG);

  // -------------------------
  // AFK ping responder
  // -------------------------
  if (message.mentions.users.size > 0) {
    for (const user of message.mentions.users.values()) {
      const afk = getAfk(user.id);
      if (!afk) continue;

      // Special response for KING
      if (user.id === KING_ID) {
        await message.reply(`👑 **The King is Busy.**${afk.reason ? `\nReason: *${afk.reason}*` : ''}`).catch(() => {});
      } else {
        await message.reply(`⚠️ **${user.username} is AFK.**${afk.reason ? `\nReason: *${afk.reason}*` : ''}`).catch(() => {});
      }
    }
  }

  // If author returns and is AFK, auto-clear when they talk (optional)
  const myAfk = getAfk(message.author.id);
  if (myAfk) {
    clearAfk(message.author.id);
    if (message.author.id === KING_ID) {
      await message.reply('👑 Welcome back, my King. AFK removed.').catch(() => {});
    } else {
      await message.reply('✅ Welcome back. AFK removed.').catch(() => {});
    }
  }

  // -------------------------
  // AUTOMOD (free, local, complex)
  // -------------------------
  if (AUTOMOD_ENABLED && !isStaff(message.member)) {
    const content = message.content;

    // Flood spam
    {
      const now = nowTs();
      const times = spamTracker.get(message.author.id) || [];
      times.push(now);
      spamTracker.set(message.author.id, times.filter(t => now - t < FLOOD_WINDOW_MS));
      if (spamTracker.get(message.author.id).length > FLOOD_LIMIT) {
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
        return;
      }
    }

    // Duplicate spam (same content repeated)
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
          if (mem) {
            await mem.timeout(TIMEOUT_ON_WARN_MS, 'Auto-timeout after warnings (duplicate spam)').catch(() => {});
            addHistory(mem.id, { type: 'timeout', reason: 'Auto-timeout (duplicate warnings)', by: 'system' });
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
        return;
      }
    }

    // Invites
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
        return;
      }
    }

    // Escalate to banish on very high warnings
    const wCount = getWarningsCount(message.author.id);
    if (wCount >= WARNINGS_BEFORE_BANISH) {
      const mem = await guild.members.fetch(message.author.id).catch(() => null);
      if (mem) {
        await applyBanish(mem, 'system', `Auto banish after ${wCount} warnings`, null).catch(() => {});
      }
      return;
    }

    // Raid mode: optional tighter rules
    if (cfg.raidMode) {
      // During raid mode, block all links (even whitelisted) if you want:
      // (keeping it mild: only block invites unless BLOCK_LINKS enabled)
    }
  }

  // -------------------------
  // COMMANDS
  // -------------------------
  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const cmd = (args.shift() || '').toLowerCase();

  // ========== BASIC ==========
  if (cmd === 'ping') {
    return message.reply(`🏓 Pong! ${client.ws.ping}ms`).catch(() => {});
  }

  if (cmd === 'help') {
    const isKing = message.author.id === KING_ID;
    const desc = [
      `**Core Commands**`,
      `• \`?banish @user [10m|2h|7d] [reason]\``,
      `• \`?restore @user\``,
      `• \`?partner @user\``,
      `• \`?appeal reason...\``,
      ``,
      `**Moderation**`,
      `• \`?warn @user reason...\``,
      `• \`?warnings @user\``,
      `• \`?clearwarnings @user\``,
      `• \`?timeout @user 10m reason...\``,
      `• \`?untimeout @user\``,
      `• \`?purge 10\``,
      `• \`?lock\` / \`?unlock\``,
      `• \`?lockdown\` / \`?unlockdown\``,
      `• \`?slowmode 5\``,
      ``,
      `**AFK**`,
      `• \`?afk [reason]\``,
      `• \`?back\``,
    ].join('\n');

    const e = new EmbedBuilder()
      .setColor(isKing ? 'Gold' : 'Blue')
      .setTitle(isKing ? '👑 Royal Command Tome' : '📜 Command List')
      .setDescription(desc)
      .setTimestamp();

    return message.reply({ embeds: [e] }).catch(() => {});
  }

  // ========== AFK ==========
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
    if (message.author.id === KING_ID) {
      return message.reply('👑 The King has returned.').catch(() => {});
    }
    return message.reply('✅ AFK removed. Welcome back!').catch(() => {});
  }

  // ========== APPEAL (PUBLIC) ==========
  if (cmd === 'appeal') {
    const reason = args.join(' ').trim();
    if (!reason) return message.reply('Provide a reason for your appeal.').catch(() => {});

    sendLog(guild, {
      color: 'Yellow',
      title: '⚖️ Appeal Submitted',
      description: `A new appeal was submitted.`,
      fields: [
        { name: 'User', value: message.author.tag, inline: true },
        { name: 'User ID', value: message.author.id, inline: true },
        { name: 'Reason', value: reason.slice(0, 900), inline: false }
      ]
    });

    addHistory(message.author.id, { type: 'appeal', reason, by: message.author.tag });

    return message.reply('✅ Your appeal has been submitted to staff.').catch(() => {});
  }

  // Everything below this line is staff-only
  if (!isStaff(message.member)) {
    return; // silent for non-staff
  }

  // ========== RAID TOGGLES ==========
  if (cmd === 'raidmode') {
    const sub = (args[0] || '').toLowerCase();
    if (sub !== 'on' && sub !== 'off') {
      return message.reply('Use `?raidmode on` or `?raidmode off`').catch(() => {});
    }
    setRaidMode(guild, sub === 'on');
    if (RAID_MODE_LOCK_CHANNELS) await lockAllTextChannels(guild, sub === 'on');
    return message.reply(`✅ Raid mode ${sub}.`).catch(() => {});
  }

  // ========== BANISH / RESTORE / PARTNER ==========
  if (cmd === 'banish') {
    const member = message.mentions.members.first();
    if (!member) return message.reply('Whom shall I banish, my King?').catch(() => {});

    // args without mention token
    const rest = args.filter(x => !x.startsWith('<@'));
    let durationMs = null;

    const parsed = parseDurationToMs(rest[0]);
    if (parsed) {
      durationMs = parsed;
      rest.shift();
    }

    const reason = rest.join(' ').trim() || 'Banished';

    await applyBanish(member, message.author.tag, reason, durationMs).catch(() => {});
    return message.channel.send(`${member.user.tag} has been banished${durationMs ? ' (timed)' : ''}.`).catch(() => {});
  }

  if (cmd === 'restore') {
    const member = message.mentions.members.first();
    if (!member) return message.reply('Whom shall I restore, my King?').catch(() => {});

    const ok = await restoreUser(member, message.author.tag, 'Manual restore').catch(() => false);
    if (!ok) return message.reply('No saved roles for this user.').catch(() => {});
    return message.channel.send(`${member.user.tag} has been restored.`).catch(() => {});
  }

  if (cmd === 'partner') {
    const member = message.mentions.members.first();
    if (!member) return message.reply('Whom shall I partner, my King?').catch(() => {});

    await member.roles.add(roleCommands.partner).catch(() => {});
    addHistory(member.id, { type: 'partner', reason: 'Partner role assigned', by: message.author.tag });

    sendLog(guild, {
      color: 'Blue',
      title: '🔵 Partner Role Given',
      description: `${member.user.tag} received Partner role.`,
      fields: [{ name: 'Moderator', value: message.author.tag, inline: true }]
    });

    return message.channel.send(`${member.user.tag} is now a Partner.`).catch(() => {});
  }

  // ========== WARN SYSTEM ==========
  if (cmd === 'warn') {
    const member = message.mentions.members.first();
    if (!member) return message.reply('Mention a user.').catch(() => {});
    const reason = args.filter(x => !x.startsWith('<@')).join(' ').trim() || 'No reason provided';

    const n = addWarning(member.id, reason);
    addHistory(member.id, { type: 'warn', reason, by: message.author.tag });

    sendLog(guild, {
      color: 'Orange',
      title: '⚠️ Warning Issued',
      description: `${member.user.tag} was warned.`,
      fields: [
        { name: 'Warnings', value: String(n), inline: true },
        { name: 'Moderator', value: message.author.tag, inline: true },
        { name: 'Reason', value: reason.slice(0, 900), inline: false }
      ]
    });

    // escalate
    if (n >= WARNINGS_BEFORE_TIMEOUT) {
      await member.timeout(TIMEOUT_ON_WARN_MS, `Reached ${WARNINGS_BEFORE_TIMEOUT} warnings`).catch(() => {});
      addHistory(member.id, { type: 'timeout', reason: 'Auto-timeout after warnings', by: 'system' });
    }
    if (n >= WARNINGS_BEFORE_BANISH) {
      await applyBanish(member, 'system', `Auto banish after ${n} warnings`, null).catch(() => {});
    }

    return message.channel.send(`⚠️ ${member.user.tag} warned. (warnings: ${n})`).catch(() => {});
  }

  if (cmd === 'warnings') {
    const member = message.mentions.members.first();
    if (!member) return message.reply('Mention a user.').catch(() => {});
    const warns = loadJson(FILE_WARNINGS);
    const list = warns[member.id] || [];
    const last = list.slice(-8).map((w, i) => `• <t:${Math.floor(w.at / 1000)}:R> — ${w.reason}`).join('\n') || 'None';

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

    addHistory(member.id, { type: 'clearwarnings', reason: 'Warnings cleared', by: message.author.tag });

    sendLog(guild, {
      color: 'Green',
      title: '✅ Warnings Cleared',
      description: `${member.user.tag} warnings cleared.`,
      fields: [{ name: 'Moderator', value: message.author.tag, inline: true }]
    });

    return message.reply('✅ Warnings cleared.').catch(() => {});
  }

  // ========== TIMEOUT / UNTIMEOUT ==========
  if (cmd === 'timeout') {
    const member = message.mentions.members.first();
    if (!member) return message.reply('Mention a user.').catch(() => {});
    const rest = args.filter(x => !x.startsWith('<@'));
    const ms = parseDurationToMs(rest[0]);
    if (!ms) return message.reply('Provide duration like `10m`, `2h`, `7d`').catch(() => {});
    rest.shift();
    const reason = rest.join(' ').trim() || 'Timed out';

    await member.timeout(ms, reason).catch(() => {});
    addHistory(member.id, { type: 'timeout', reason, by: message.author.tag, until: nowTs() + ms });

    sendLog(guild, {
      color: 'Orange',
      title: '⏳ Timeout Applied',
      description: `${member.user.tag} was timed out.`,
      fields: [
        { name: 'Moderator', value: message.author.tag, inline: true },
        { name: 'Duration', value: `${Math.floor(ms / 60000)} minutes`, inline: true },
        { name: 'Reason', value: reason.slice(0, 900), inline: false }
      ]
    });

    return message.channel.send(`⏳ Timed out ${member.user.tag}.`).catch(() => {});
  }

  if (cmd === 'untimeout') {
    const member = message.mentions.members.first();
    if (!member) return message.reply('Mention a user.').catch(() => {});
    await member.timeout(null).catch(() => {});
    addHistory(member.id, { type: 'untimeout', reason: 'Timeout cleared', by: message.author.tag });

    sendLog(guild, {
      color: 'Green',
      title: '✅ Timeout Cleared',
      description: `${member.user.tag} timeout cleared.`,
      fields: [{ name: 'Moderator', value: message.author.tag, inline: true }]
    });

    return message.reply('✅ Timeout cleared.').catch(() => {});
  }

  // ========== HISTORY ==========
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
      return `• **${t}** by **${by}** ${when}${r ? ` — ${r}` : ''}`;
    }).join('\n');

    return message.reply(`History for **${member.user.tag}**:\n${lines}`.slice(0, 1900)).catch(() => {});
  }

  // ========== CHANNEL TOOLS ==========
  if (cmd === 'purge') {
    const n = Number(args[0]);
    if (!Number.isFinite(n) || n <= 0 || n > 100) {
      return message.reply('Use `?purge 1-100`').catch(() => {});
    }
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
});

// =====================================================
client.login(token);
