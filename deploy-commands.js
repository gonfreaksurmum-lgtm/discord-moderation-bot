const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const token = const token = process.env.TOKEN;
const clientId = '1472233690473042056';
const guildId = '1431994042165493881';

const commands = [
  new SlashCommandBuilder()
    .setName('addrolecommand')
    .setDescription('Create a custom role command')
    .addStringOption(option =>
      option.setName('name')
        .setDescription('Command name')
        .setRequired(true))
    .addRoleOption(option =>
      option.setName('role')
        .setDescription('Role to assign')
        .setRequired(true))
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    console.log('Registering commands...');

    await rest.put(
      Routes.applicationGuildCommands(clientId, guildId),
      { body: commands }
    );

    console.log('Commands registered!');
  } catch (error) {
    console.error(error);
  }
})();
