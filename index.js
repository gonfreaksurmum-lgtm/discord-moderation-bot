const token = process.env.TOKEN;

const { 
  Client, 
  GatewayIntentBits, 
  PermissionsBitField 
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

// 🔥 CONFIG
const roleCommands = {
  banish: '1431994048314347626',
  partner: '1431994048314347629'
};

const logChannelId = '1431994052169171128';

// Storage file
const storageFile = './roleData.json';

// Create file if missing
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
  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  if (!['banish', 'restore', 'partner'].includes(command)) return;

  if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    return message.reply("Only administrators can use this.");
  }

  const member = message.mentions.members.first();
  if (!member) return message.reply("Mention a user.");

  const logChannel = message.guild.channels.cache.get(logChannelId);
  const data = loadData();

  try {

    // 🔥 BANISH
    if (command === 'banish') {

      const savedRoles = member.roles.cache
        .filter(r => r.id !== message.guild.id)
        .map(r => r.id);

      data[member.id] = savedRoles;
      saveData(data);

      await member.roles.set([]); // remove all roles
      await member.roles.add(roleCommands.banish);

      message.channel.send(`${member.user.tag} has been banished.`);
      if (logChannel) {
        logChannel.send(`🔴 ${member.user.tag} was banished by ${message.author.tag}`);
      }
      return;
    }

    // 🔥 RESTORE
    if (command === 'restore') {

      if (!data[member.id]) {
        return message.reply("No saved roles for this user.");
      }

      await member.roles.set([]);
      await member.roles.add(data[member.id]);

      delete data[member.id];
      saveData(data);

      message.channel.send(`${member.user.tag} has been restored.`);
      if (logChannel) {
        logChannel.send(`🟢 ${member.user.tag} was restored by ${message.author.tag}`);
      }
      return;
    }

    // 🔥 PARTNER
    if (command === 'partner') {
      await member.roles.add(roleCommands.partner);
      message.channel.send(`${member.user.tag} has been given Partner.`);
      if (logChannel) {
        logChannel.send(`🔵 ${member.user.tag} was partnered by ${message.author.tag}`);
      }
      return;
    }

  } catch (err) {
    console.error(err);
    message.reply("Action failed. Check role hierarchy.");
  }
});

client.login(token);
