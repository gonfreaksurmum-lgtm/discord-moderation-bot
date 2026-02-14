module.exports = async (message) => {

  if (!message.guild) return;

  const bannedWords = [
    "nig",
    "nigger",
    "bum",
    "slur",
    "faggot",
    "noob",
    "bitch",
    "trash",
    "discord.gg/",
    "http://",
    "https://"
  ];

  const content = message.content.toLowerCase();

  const found = bannedWords.find(word => content.includes(word));

  if (found) {
    await message.delete().catch(() => {});

    await message.channel.send({
      content: `${message.author}, that content is not allowed.`,
      allowedMentions: { users: [] }
    });

    return true;
  }

  return false;
};
