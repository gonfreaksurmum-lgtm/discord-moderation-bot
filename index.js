const token = process.env.TOKEN;

const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  EmbedBuilder
} = require('discord.js');

const fs = require('fs');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const prefix = '?';

// ================= CONFIG =================
const roleCommands = {
  banish: '1431994048314347626',
  partner: '1431994048314347629'
};

const logChannelId = '1431994052169171128';

// ================= STORAGE FILES =================
const roleDataFile = './roleData.json';
const banishedFile = './banished.json';

if (!fs.existsSync(roleDataFile))
  fs.writeFileSync(roleDataFile, JSON.stringify({}));

if (!fs.existsSync(banishedFile))
  fs.writeFileSync(banishedFile, JSON.stringify([]));

function loadRoles() {
  return JSON.parse(fs.readFileSync(roleDataFile));
}

function saveRoles(data) {
  fs.writeFileSync(roleDataFile, JSON.stringify(data, null, 2));
}

function loadBanished() {
  return JSON.parse(fs.readFileSync(banishedFile));
}

function saveBanished(data) {
  fs.writeFileSync(banishedFile, JSON.stringify(data, null, 2));
}

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// ================= AUTOMOD =================
const spamTracker = new Map();

client.on('messageCreate', async message => {
  if (!message.guild) return;
  if (message.author.bot) return;

  const logChannel = message.guild.channels.cache.get(logChannelId);

  // ===== Anti Invite =====
  if (message.content.match(/discord\.gg|discord\.com\/invite/gi)) {
    await message.delete().catch(() => {});
    message.channel.send(`${message.author}, invite links are not allowed.`);
    return;
  }

  // ===== Anti Spam (5 messages in 5 seconds) =====
  const now = Date.now();
  const timestamps = spamTracker.get(message.author.id) || [];
  timestamps.push(now);
  spamTracker.set(
    message.author.id,
    timestamps.filter(t => now - t < 5000)
  );

  if (spamTracker.get(message.author.id).length > 5) {
    await message.delete().catch(() => {});
    message.channel.send(`${message.author}, stop spamming.`);
    return;
  }

  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  const roleData = loadRoles();
  const banishedUsers = loadBanished();

  try {

    // ================= APPEAL =================
    if (command === 'appeal') {

      const reason = args.join(' ');
      if (!reason)
        return message.reply("Provide the reason for your appeal.");

      const embed = new EmbedBuilder()
        .setColor('Yellow')
        .setTitle('New Appeal Submitted')
        .addFields(
          { name: 'User', value: message.author.tag },
          { name: 'Reason', value: reason }
        )
        .setTimestamp();

      await message.reply("Your appeal has been submitted.");
      if (logChannel) logChannel.send({ embeds: [embed] });

      return;
    }

    // ================= ADMIN CHECK =================
    if (
      ['banish', 'restore', 'partner'].includes(command) &&
      !message.member.permissions.has(PermissionsBitField.Flags.Administrator)
    ) {
      return message.reply("❌ Only administrators can use this.");
    }

    // ================= BANISH =================
    if (command === 'banish') {

      const member = message.mentions.members.first();
      if (!member)
        return message.reply("Whom shall I banish, my King?");

      const savedRoles = member.roles.cache
        .filter(r => r.id !== message.guild.id)
        .map(r => r.id);

      roleData[member.id] = savedRoles;
      saveRoles(roleData);

      if (!banishedUsers.includes(member.id)) {
        banishedUsers.push(member.id);
        saveBanished(banishedUsers);
      }

      await member.roles.set([]);
      await member.roles.add(roleCommands.banish);

      const embed = new EmbedBuilder()
        .setColor('Red')
        .setTitle('User Banished')
        .addFields(
          { name: 'User', value: member.user.tag, inline: true },
          { name: 'Moderator', value: message.author.tag, inline: true }
        )
        .setTimestamp();

      await message.channel.send(`${member.user.tag} has been banished.`);
      if (logChannel) logChannel.send({ embeds: [embed] });

      return;
    }

    // ================= RESTORE =================
    if (command === 'restore') {

      const member = message.mentions.members.first();
      if (!member)
        return message.reply("Whom shall I restore, my King?");

      if (!roleData[member.id])
        return message.reply("No saved roles for this user.");

      await member.roles.set([]);
      await member.roles.add(roleData[member.id]);

      delete roleData[member.id];
      saveRoles(roleData);

      const updatedBanished = banishedUsers.filter(id => id !== member.id);
      saveBanished(updatedBanished);

      const embed = new EmbedBuilder()
        .setColor('Green')
        .setTitle('User Restored')
        .addFields(
          { name: 'User', value: member.user.tag, inline: true },
          { name: 'Moderator', value: message.author.tag, inline: true }
        )
        .setTimestamp();

      await message.channel.send(`${member.user.tag} has been restored.`);
      if (logChannel) logChannel.send({ embeds: [embed] });

      return;
    }

    // ================= PARTNER =================
    if (command === 'partner') {

      const member = message.mentions.members.first();
      if (!member)
        return message.reply("Whom shall I partner, my King?");

      await member.roles.add(roleCommands.partner);

      const embed = new EmbedBuilder()
        .setColor('Blue')
        .setTitle('Partner Role Given')
        .addFields(
          { name: 'User', value: member.user.tag, inline: true },
          { name: 'Moderator', value: message.author.tag, inline: true }
        )
        .setTimestamp();

      await message.channel.send(`${member.user.tag} is now a Partner.`);
      if (logChannel) logChannel.send({ embeds: [embed] });

      return;
    }

  } catch (err) {
    console.error(err);
    message.reply("⚠️ Action failed. Check role hierarchy.");
  }
});

// ================= REJOIN AUTO BANISH =================
client.on('guildMemberAdd', async member => {
  const banishedUsers = loadBanished();

  if (banishedUsers.includes(member.id)) {
    try {
      await member.roles.add(roleCommands.banish);
      console.log(`Re-applied banish role to ${member.user.tag}`);
    } catch (err) {
      console.error("Failed to reapply banish role:", err);
    }
  }
});

client.login(token);
