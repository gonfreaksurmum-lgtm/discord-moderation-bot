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

// ===== CONFIG =====
const roleCommands = {
  banish: '1431994048314347626',
  partner: '1431994048314347629'
};

const logChannelId = '1431994052169171128';

// ===== STORAGE =====
const storageFile = './roleData.json';

if (!fs.existsSync(storageFile)) {
  fs.writeFileSync(storageFile, JSON.stringify({}));
}

function loadData() {
  return JSON.parse(fs.readFileSync(storageFile));
}

function saveData(data) {
  fs.writeFileSync(storageFile, JSON.stringify(data, null, 2));
}

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  const logChannel = message.guild.channels.cache.get(logChannelId);
  const data = loadData();

  // ===== PERMISSION CHECK =====
  if (
    ['banish', 'restore', 'partner'].includes(command) &&
    !message.member.permissions.has(PermissionsBitField.Flags.Administrator)
  ) {
    return message.reply("❌ Only administrators can use this.");
  }

  try {

    // =========================
    // 🔴 BANISH
    // =========================
    if (command === 'banish') {

      const member = message.mentions.members.first();
      if (!member) return message.reply("Mention a user.");

      const savedRoles = member.roles.cache
        .filter(r => r.id !== message.guild.id)
        .map(r => r.id);

      data[member.id] = savedRoles;
      saveData(data);

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

    // =========================
    // 🟢 RESTORE
    // =========================
    if (command === 'restore') {

      const member = message.mentions.members.first();
      if (!member) return message.reply("Mention a user.");

      if (!data[member.id]) {
        return message.reply("No saved roles for this user.");
      }

      await member.roles.set([]);
      await member.roles.add(data[member.id]);

      delete data[member.id];
      saveData(data);

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

    // =========================
    // 🔵 PARTNER
    // =========================
    if (command === 'partner') {

      const member = message.mentions.members.first();
      if (!member) return message.reply("Mention a user.");

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

    // =========================
    // 🟡 APPEAL
    // =========================
    if (command === 'appeal') {

      const appealReason = args.join(' ');
      if (!appealReason) {
        return message.reply("Provide a reason for your appeal.");
      }

      const embed = new EmbedBuilder()
        .setColor('Yellow')
        .setTitle('New Appeal Submitted')
        .addFields(
          { name: 'User', value: message.author.tag },
          { name: 'Reason', value: appealReason }
        )
        .setTimestamp();

      await message.reply("Your appeal has been submitted.");
      if (logChannel) logChannel.send({ embeds: [embed] });

      return;
    }

  } catch (err) {
    console.error(err);
    message.reply("⚠️ Action failed. Check role hierarchy.");
  }
});

client.login(token);
