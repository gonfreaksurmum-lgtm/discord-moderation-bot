const { PermissionsBitField, ChannelType, EmbedBuilder } = require('discord.js');

module.exports = async (client, message) => {

    const guild = message.guild;

    const existing = guild.channels.cache.find(
        c => c.name === `ticket-${message.author.id}`
    );

    if (existing) {
        return message.reply("You already have an open ticket.");
    }

    const channel = await guild.channels.create({
        name: `ticket-${message.author.id}`,
        type: ChannelType.GuildText,
        permissionOverwrites: [
            {
                id: guild.id,
                deny: [PermissionsBitField.Flags.ViewChannel]
            },
            {
                id: message.author.id,
                allow: [
                    PermissionsBitField.Flags.ViewChannel,
                    PermissionsBitField.Flags.SendMessages
                ]
            }
        ]
    });

    const embed = new EmbedBuilder()
        .setColor("Blue")
        .setTitle("🎫 Support Ticket")
        .setDescription("A staff member will assist you shortly.\nType `?close` to close this ticket.")
        .setTimestamp();

    channel.send({ embeds: [embed] });
    message.reply("Your ticket has been created.");
};
