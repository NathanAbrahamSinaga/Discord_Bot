require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fetch = require('node-fetch');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
let model;

const systemPrompt = "Jawab dengan bahasa Indonesia dan gunakan format Markdown. Untuk setiap daftar, pastikan setiap item dimulai pada baris baru dengan tanda '-'. Jangan gabungkan beberapa item dalam satu baris. Contoh format yang benar:\n- Item pertama\n- Item kedua\n- Item ketiga\nJika ada subjudul atau poin utama, gunakan '**Judul**' diikuti daftar dengan '-'. Pastikan output rapi dan mudah dibaca di Discord.";

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
  'image/gif': 'gif',
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
      searchResults += `- **${index + 1}. ${item.title}**\n`;
      searchResults += `- ${item.snippet}\n`;
      searchResults += `- Sumber: ${item.link}\n\n`;
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
          maxOutputTokens: 4000,
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

function ensureListFormatting(text) {
  const lines = text.split('\n');
  const processedLines = [];
  let inList = false;
  let lastSubheader = '';

  for (let line of lines) {
    line = line.trim();
    if (line.startsWith('**') && line.endsWith('**')) {
      if (processedLines.length > 0) processedLines.push('');
      processedLines.push(line);
      lastSubheader = line;
      inList = false;
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      processedLines.push(line.startsWith('- ') ? line : `- ${line.slice(2)}`);
      inList = true;
    } else if (line && inList) {
      processedLines.push(`- ${line}`);
    } else if (line.includes(' - ') || line.includes(' * ')) {
      const separator = line.includes(' - ') ? ' - ' : ' * ';
      const items = line.split(separator).map(item => item.trim()).filter(item => item);
      items.forEach((item, index) => {
        processedLines.push(`${index === 0 && !item.startsWith('-') ? '' : '-' } ${item}`);
      });
      inList = true;
    } else if (line && !inList && lastSubheader) {
      processedLines.push(`- ${line}`);
      inList = true;
    } else {
      processedLines.push(line);
      inList = false;
    }
  }

  return processedLines.join('\n');
}

function splitText(text, maxLength = 2000) {
  const chunks = [];
  let currentChunk = '';
  const lines = text.split('\n');
  let lastSubheader = '';

  for (const line of lines) {
    if (line.startsWith('**') && line.endsWith('**')) {
      lastSubheader = line;
    }

    if (currentChunk.length + line.length + 1 > maxLength) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = lastSubheader ? `${lastSubheader}\n\n${line}` : line;
      } else {
        const words = line.split(' ');
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
      currentChunk += (currentChunk ? '\n' : '') + line;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }

  return chunks.map(chunk => ensureListFormatting(chunk));
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
    const giftPrompt = "Berikan daftar saran hadiah menarik dalam bahasa Indonesia menggunakan format Markdown.";
    try {
      const aiResponse = await generateResponse(channelId, giftPrompt);
      const responseChunks = splitText(aiResponse);
      for (let i = 0; i < responseChunks.length; i++) {
        if (i > 0) await new Promise(resolve => setTimeout(resolve, 1000));
        await message.channel.send(responseChunks[i]);
      }
    } catch (error) {
      console.error('Error saat merespons gift:', error);
      await message.reply('Terjadi kesalahan saat merespons perintah !gift. Silakan coba lagi nanti.');
    }
    return;
  }

  if (isBotActive || content.startsWith('!chat') || content.startsWith('!cari')) {
    let prompt = content;
    let searchQuery = null;

    if (content.startsWith('!cari')) {
      searchQuery = content.replace('!cari', '').trim();
      prompt = `Berikan jawaban berdasarkan pencarian untuk: ${searchQuery}`;
    } else if (content.startsWith('!chat')) {
      prompt = content.replace('!chat', '').trim();
    } else if (isBotActive && !content.startsWith('!')) {
      prompt = content;
    }

    const attachment = message.attachments.first();
    let mediaData = null;

    if (attachment) {
      const mimeType = attachment.contentType;
      if (!SUPPORTED_MIME_TYPES[mimeType]) {
        await message.reply('Format file tidak didukung. Format yang didukung: JPEG, PNG, GIF, PDF, MP4, MP3, WAV');
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
        if (!prompt || prompt === content) {
          if (fileType === 'image') enhancedPrompt = "Deskripsikan gambar ini dalam bahasa Indonesia menggunakan format Markdown.";
          else if (fileType === 'gif') enhancedPrompt = "Deskripsikan GIF ini dalam bahasa Indonesia menggunakan format Markdown."; // Prompt khusus untuk GIF
          else if (fileType === 'video') enhancedPrompt = "Deskripsikan video ini dalam bahasa Indonesia menggunakan format Markdown.";
          else if (fileType === 'audio') enhancedPrompt = "Deskripsikan audio ini dalam bahasa Indonesia menggunakan format Markdown.";
          else if (fileType === 'pdf') enhancedPrompt = "Ringkas isi PDF ini dalam bahasa Indonesia menggunakan format Markdown.";
        }

        await message.channel.sendTyping();
        const aiResponse = await generateResponse(channelId, enhancedPrompt, mediaData, searchQuery);
        const responseChunks = splitText(aiResponse);
        for (let i = 0; i < responseChunks.length; i++) {
          if (i > 0) await new Promise(resolve => setTimeout(resolve, 1000));
          await message.channel.send(responseChunks[i]);
        }
      } catch (error) {
        console.error('Error memproses lampiran:', error);
        if (mimeType === 'image/gif') {
          await message.reply('Saya tidak bisa memproses GIF secara langsung. Silakan berikan deskripsi teks dari GIF tersebut agar saya bisa membantu Anda!');
        } else {
          await message.reply('Terjadi kesalahan saat memproses file lampiran.');
        }
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