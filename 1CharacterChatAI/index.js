require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
let model;
const systemPrompt = "Anda adalah asisten yang membantu dan ramah. Saat memberikan contoh kode, selalu gunakan format Markdown yang tepat dengan tiga tanda backtick (```) dan tentukan bahasa pemrograman (misalnya, ```javascript). Pastikan setiap blok kode ditutup dengan tiga tanda backtick (```) untuk menjaga format yang rapi, meskipun responsnya panjang.";

function updateModel() {
  model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    systemInstruction: {
      role: 'model',
      parts: [{ text: systemPrompt }]
    }
  });
}
updateModel();

const conversationHistory = new Map();
const commandCooldowns = new Map();
const channelActivity = new Map();
const MAX_HISTORY = 10;
const COOLDOWN_TIME = 30000;

// Fungsi untuk dynamic import node-fetch
const fetch = async (...args) => {
  const { default: fetch } = await import('node-fetch');
  return fetch(...args);
};

async function generateResponse(channelId, prompt, mediaData = null) {
  try {
    if (!conversationHistory.has(channelId)) {
      conversationHistory.set(channelId, model.startChat({
        history: [],
        generationConfig: {
          temperature: 0.9,
          maxOutputTokens: 2000,
        }
      }));
    }

    const chat = conversationHistory.get(channelId);
    let result;

    if (mediaData) {
      const mediaParts = [
        {
          inlineData: {
            mimeType: mediaData.mimeType,
            data: mediaData.base64
          }
        }
      ];
      result = await chat.sendMessage([prompt, ...mediaParts]);
    } else {
      result = await chat.sendMessage(prompt);
    }

    const response = await result.response;
    
    const history = await chat.getHistory();
    if (history.length > MAX_HISTORY * 2) {
      history.splice(0, history.length - MAX_HISTORY * 2);
    }
    
    return response.text();
  } catch (error) {
    console.error('Error in generateResponse:', error);
    throw error;
  }
}

function splitText(text, maxLength = 2000) {
  const chunks = [];
  let currentChunk = '';
  const sentences = text.split(/(?<=[.!\?])\s+/);

  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length + 1 > maxLength) {
      if (currentChunk) {
        chunks.push(currentChunk);
        currentChunk = sentence;
      } else {
        const words = sentence.split(' ');
        for (const word of words) {
          if (currentChunk.length + word.length + 1 > maxLength) {
            chunks.push(currentChunk);
            currentChunk = word;
          } else {
            currentChunk += (currentChunk ? ' ' : '') + word;
          }
        }
      }
    } else {
      currentChunk += (currentChunk ? ' ' : '') + sentence;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  console.log(`Total chunks: ${chunks.length}`);
  chunks.forEach((chunk, index) => {
    console.log(`Chunk ${index + 1} length: ${chunk.length}`);
  });

  return chunks;
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once('ready', () => {
  console.log(`Bot ${client.user.tag} is ready!`);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  const { commandName, user, channelId } = interaction;
  const now = Date.now();
  const cooldownKey = `${user.id}-${commandName}`;
  const cooldownEndTime = commandCooldowns.get(cooldownKey) || 0;

  if (now < cooldownEndTime) {
    const remainingTime = (cooldownEndTime - now) / 1000;
    return interaction.reply({ content: `Please wait ${remainingTime.toFixed(1)} seconds before using this command again.`, ephemeral: true });
  }

  commandCooldowns.set(cooldownKey, now + COOLDOWN_TIME);

  if (commandName === 'activate') {
    channelActivity.set(channelId, true);
    await interaction.reply('Bot activated in this channel!');
  } else if (commandName === 'deactivate') {
    channelActivity.set(channelId, false);
    await interaction.reply('Bot deactivated in this channel!');
  }
});

client.on('messageCreate', async message => {
  if (message.author.bot) return;

  const channelId = message.channel.id;
  const isBotActive = channelActivity.get(channelId) || false;

  if (isBotActive || message.content.startsWith('!chat')) {
    const prompt = message.content.replace('!chat', '').trim();
    const attachment = message.attachments.first();
    let mediaData = null;

    if (attachment) {
      const response = await (await fetch)(attachment.url);
      const buffer = await response.buffer();
      const base64 = buffer.toString('base64');
      mediaData = {
        mimeType: attachment.contentType,
        base64: base64
      };
    }

    try {
      await message.channel.sendTyping();

      const response = await generateResponse(channelId, prompt, mediaData);
      console.log(`Response length: ${response.length}`);
      const responseChunks = splitText(response, 2000);

      for (let i = 0; i < responseChunks.length; i++) {
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        await message.channel.send(responseChunks[i]);
      }
    } catch (error) {
      console.error('Error in messageCreate:', error);
      await message.reply('Terjadi kesalahan, silakan coba lagi nanti.');
    }
  }
});

client.login(process.env.DISCORD_TOKEN);