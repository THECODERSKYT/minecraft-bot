const mineflayer = require('mineflayer');

const bot = mineflayer.createBot({
  host: 'SKYT1100.aternos.me', // Replace with your server IP
  port: 25565, // Default Minecraft port
  username: 'yahoo', // Replace with your bot's username
});

bot.on('chat', (username, message) => {
  if (username !== bot.username) {
    console.log(`${username}: ${message}`);
  }
});

bot.on('spawn', () => {
  console.log('Bot has spawned!');
});

bot.on('end', () => {
  console.log('Bot disconnected. Reconnecting...');
  setTimeout(() => {
    bot = mineflayer.createBot({ ...bot.options });
  }, 5000); // Reconnect after 5 seconds
});

bot.on('error', (err) => {
  console.error('Error:', err);
});
