require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fetch = require('node-fetch');

// Inisialisasi Gemini API dengan API Key dari file .env
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
let model;
const systemPrompt = "Jawab dengan bahasa Indonesia dan gunakan format Markdown untuk daftar, dengan setiap item daftar dimulai pada baris baru dengan tanda '-' atau '*'.";

function updateModel() {
  model = genAI.getGenerativeModel({
    model: 'gemini-1.5-flash',
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
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GOOGLE_CSE_ID = process.env.GOOGLE_CSE_ID;

const SUPPORTED_MIME_TYPES = {
  'image/jpeg': 'image',
  'image/png': 'image',
  'application/pdf': 'pdf',
  'video/mp4': 'video',
  'video/mpeg': 'video',
  'audio/mp3': 'audio',
  'audio/mpeg': 'audio',
  'audio/wav': 'audio'
};

async function googleSearch(query) {
  try {
    const url = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CSE_ID}&q=${encodeURIComponent(query)}&num=3`;
    const response = await fetch(url);

    if (!response.ok) {
      const errorText = await response.text();
      return `Maaf, terjadi kesalahan saat mengakses API Google. Status: ${response.status}, Pesan: ${errorText}`;
    }

    const data = await response.json();
    if (!data.items || data.items.length === 0) {
      return "Maaf, tidak ada hasil yang ditemukan untuk pencarian ini.";
    }

    let searchResults = "Berikut adalah hasil pencarian dari Google:\n\n";
    data.items.forEach((item, index) => {
      searchResults += `${index + 1}. **${item.title}**\n`;
      searchResults += `${item.snippet}\n`;
      searchResults += `Sumber: ${item.link}\n\n`;
    });

    return searchResults;
  } catch (error) {
    console.error('Error di googleSearch:', error);
    return "Terjadi kesalahan saat melakukan pencarian Google.";
  }
}

async function generateResponse(channelId, prompt, mediaData = null, searchQuery = null) {
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
    let finalPrompt = prompt;

    if (searchQuery) {
      const searchResults = await googleSearch(searchQuery);
      finalPrompt = `${prompt}\n\nBerikut adalah informasi dari pencarian Google yang mungkin membantu:\n${searchResults}`;
    }

    if (mediaData) {
      const mediaParts = [{
        inlineData: {
          mimeType: mediaData.mimeType,
          data: mediaData.base64
        }
      }];
      result = await chat.sendMessage([finalPrompt, ...mediaParts]);
    } else {
      result = await chat.sendMessage(finalPrompt);
    }

    const responseText = await result.response.text();

    const history = await chat.getHistory();
    if (history.length > MAX_HISTORY * 2) {
      history.splice(0, history.length - MAX_HISTORY * 2);
    }

    return responseText;
  } catch (error) {
    console.error('Error di generateResponse:', error);
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
        chunks.push(currentChunk.trim());
        currentChunk = sentence;
      } else {
        const words = sentence.split(' ');
        for (const word of words) {
          if (currentChunk.length + word.length + 1 > maxLength) {
            chunks.push(currentChunk.trim());
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
    chunks.push(currentChunk.trim());
  }

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
  console.log(`Bot ${client.user.tag} siap!`);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  const { commandName, user, channelId } = interaction;
  const now = Date.now();
  const cooldownKey = `${user.id}-${commandName}`;
  const cooldownEndTime = commandCooldowns.get(cooldownKey) || 0;

  if (now < cooldownEndTime) {
    const remainingTime = (cooldownEndTime - now) / 1000;
    return interaction.reply({
      content: `Silakan tunggu ${remainingTime.toFixed(1)} detik sebelum menggunakan perintah ini lagi.`,
      ephemeral: true
    });
  }

  commandCooldowns.set(cooldownKey, now + COOLDOWN_TIME);

  if (commandName === 'activate') {
    channelActivity.set(channelId, true);
    await interaction.reply('Bot diaktifkan di channel ini!');
  } else if (commandName === 'deactivate') {
    channelActivity.set(channelId, false);
    await interaction.reply('Bot dinonaktifkan di channel ini!');
  }
});

client.on('messageCreate', async message => {
  if (message.author.bot) return;

  const channelId = message.channel.id;
  const isBotActive = channelActivity.get(channelId) || false;
  const content = message.content.trim();

  if (content.toLowerCase().startsWith('!gift')) {
    await message.channel.sendTyping();
    const giftPrompt = "Pengguna mengirimkan gift. Berikan respons yang kreatif dan berterima kasih dalam bahasa Indonesia.";
    try {
      const aiResponse = await generateResponse(channelId, giftPrompt);
      const responseChunks = splitText(aiResponse);
      for (let i = 0; i < responseChunks.length; i++) {
        if (i > 0) await new Promise(resolve => setTimeout(resolve, 1000));
        await message.channel.send(responseChunks[i]);
      }
    } catch (error) {
      console.error('Error saat merespons gift:', error);
      await message.reply('Terjadi kesalahan saat merespons gift. Silakan coba lagi nanti.');
    }
    return;
  }

  // Logika untuk perintah lain seperti !chat atau !cari
  if (isBotActive || content.startsWith('!chat') || content.startsWith('!cari')) {
    let prompt = content;
    let searchQuery = null;

    if (content.startsWith('!cari')) {
      searchQuery = content.replace('!cari', '').trim();
      prompt = `Berikan jawaban berdasarkan pencarian untuk: ${searchQuery}`;
    } else if (content.startsWith('!chat')) {
      prompt = content.replace('!chat', '').trim();
    }

    const attachment = message.attachments.first();
    let mediaData = null;

    if (attachment) {
      const mimeType = attachment.contentType;
      if (!SUPPORTED_MIME_TYPES[mimeType]) {
        await message.reply('Format file tidak didukung. Format yang didukung: JPEG, PNG, PDF, MP4, MP3, WAV');
        return;
      }

      try {
        const fetchResponse = await fetch(attachment.url);
        const buffer = await fetchResponse.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        mediaData = {
          mimeType: mimeType,
          base64: base64
        };

        const fileType = SUPPORTED_MIME_TYPES[mimeType];
        let enhancedPrompt = prompt;
        if (fileType === 'image' && !prompt) enhancedPrompt = systemPrompt;
        else if (fileType === 'video' && !prompt) enhancedPrompt = systemPrompt;
        else if (fileType === 'audio' && !prompt) enhancedPrompt = systemPrompt;
        else if (fileType === 'pdf' && !prompt) enhancedPrompt = systemPrompt;

        await message.channel.sendTyping();
        const aiResponse = await generateResponse(channelId, enhancedPrompt, mediaData, searchQuery);
        const responseChunks = splitText(aiResponse);

        for (let i = 0; i < responseChunks.length; i++) {
          if (i > 0) await new Promise(resolve => setTimeout(resolve, 1000));
          await message.channel.send(responseChunks[i]);
        }
      } catch (error) {
        console.error('Error memproses lampiran:', error);
        await message.reply('Terjadi kesalahan saat memproses file lampiran.');
      }
    } else {
      try {
        await message.channel.sendTyping();
        const aiResponse = await generateResponse(channelId, prompt, null, searchQuery);
        const responseChunks = splitText(aiResponse);

        for (let i = 0; i < responseChunks.length; i++) {
          if (i > 0) await new Promise(resolve => setTimeout(resolve, 1000));
          await message.channel.send(responseChunks[i]);
        }
      } catch (error) {
        console.error('Error di messageCreate:', error);
        await message.reply('Terjadi kesalahan, silakan coba lagi nanti.');
      }
    }
  }
});

client.login(process.env.DISCORD_TOKEN);