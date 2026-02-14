const token = process.env.TOKEN;

const { 
  Client, 
  GatewayIntentBits, 
  PermissionsBitField 
} = require('discord.js');

const fs = require('fs');

const logger = require('./systems/logger');
const automod = require('./systems/automod');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const prefix = '?';

// CONFIG
const roleCommands = {
  banish: '1431994048314347626',
  partner: '1431994048314347629'
};

const logChannelId = '1431994052169171128';

// Storage file
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
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async message => {
  if (message.author.bot) return;

  // AUTOMOD
  await automod(message);

  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  if (!['banish', 'restore', 'partner', 'appeal'].includes(command)) return;

  // APPEAL SYSTEM (no admin required)
  if (command === 'appeal') {

    const reason = args.join(" ");
    if (!reason) return message.reply("Provide a reason for your appeal.");

    logger(message.guild, logChannelId, {
      title: "⚖️ Appeal Submitted",
      description: `User: ${message.author.tag}\n\nReason:\n${reason}`,
      color: "Orange",
      userId: message.author.id
    });

    return message.reply("Your appeal has been submitted to staff.");
  }

  // Admin-only commands
  if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    return message.reply("Only administrators can use this.");
  }

  const member = message.mentions.members.first();
  if (!member) return message.reply("Mention a user.");

  const data = loadData();

  try {

    // BANISH
    if (command === 'banish') {

      const savedRoles = member.roles.cache
        .filter(r => r.id !== message.guild.id)
        .map(r => r.id);

      data[member.id] = savedRoles;
      saveData(data);

      await member.roles.set([]);
      await member.roles.add(roleCommands.banish);

      message.channel.send(`${member.user.tag} has been banished.`);

      logger(message.guild, logChannelId, {
        title: "🔴 User Banished",
        description: `${member.user.tag} has been banished.`,
        color: "Red",
        userId: member.id,
        moderator: message.author.tag
      });

      return;
    }

    // RESTORE
    if (command === 'restore') {

      if (!data[member.id]) {
        return message.reply("No saved roles for this user.");
      }

      await member.roles.set([]);
      await member.roles.add(data[member.id]);

      delete data[member.id];
      saveData(data);

      message.channel.send(`${member.user.tag} has been restored.`);

      logger(message.guild, logChannelId, {
        title: "🟢 User Restored",
        description: `${member.user.tag} has been restored.`,
        color: "Green",
        userId: member.id,
        moderator: message.author.tag
      });

      return;
    }

    // PARTNER
    if (command === 'partner') {

      await member.roles.add(roleCommands.partner);

      message.channel.send(`${member.user.tag} has been given Partner.`);

      logger(message.guild, logChannelId, {
        title: "🔵 Partner Role Given",
        description: `${member.user.tag} was given Partner role.`,
        color: "Blue",
        userId: member.id,
        moderator: message.author.tag
      });

      return;
    }

  } catch (err) {
    console.error(err);
    message.reply("Action failed. Check role hierarchy.");
  }
});

client.login(token);
