require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fetch = require('node-fetch');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
let model;

const systemPrompt = `
Jawab dengan bahasa Indonesia. Pastikan output rapi dan mudah dibaca di Discord menggunakan format Markdown:
- Gunakan # untuk heading besar, ## untuk subheading.
- Gunakan - untuk bullet point pada list.
- Gunakan ** untuk teks tebal, * untuk italic.
- Gunakan \`\`\` untuk blok kode (contoh: \`\`\`javascript).
- Pisahkan paragraf dengan baris kosong.
- Batasi pesan agar tidak melebihi 2000 karakter.
`;

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
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GOOGLE_CSE_ID = process.env.GOOGLE_CSE_ID;

const SUPPORTED_MIME_TYPES = {
  'image/jpeg': 'gambar',
  'image/png': 'gambar',
  'image/gif': 'GIF',
  'application/pdf': 'PDF',
  'video/mp4': 'video',
  'video/mpeg': 'video',
  'audio/mp3': 'audio',
  'audio/mpeg': 'audio',
  'audio/wav': 'audio'
};

const MEDIA_PROMPTS = {
  'gambar': 'tanggapi gambarnya',
  'GIF': 'tanggapi GIF-nya',
  'PDF': 'Berikan analisis PDF-nya.',
  'video': 'tanggapi video-nya',
  'audio': 'tanggapi audio-nya'
};

async function googleSearch(query) {
  try {
    const url = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CSE_ID}&q=${encodeURIComponent(query)}&num=3`;
    const response = await fetch(url);

    if (!response.ok) {
      const errorText = await response.text();
      return `**Error Pencarian**\nMaaf, terjadi kesalahan saat mengakses API Google.\n- Status: ${response.status}\n- Pesan: ${errorText}`;
    }

    const data = await response.json();
    if (!data.items || data.items.length === 0) {
      return "**Hasil Pencarian**\nMaaf, tidak ada hasil yang ditemukan untuk pencarian ini.";
    }

    let searchResults = "**Hasil Pencarian dari Google**\n\n";
    data.items.forEach((item, index) => {
      searchResults += `- **${index + 1}. ${item.title}**\n`;
      searchResults += `  ${item.snippet}\n`;
      searchResults += `  Sumber: [Klik di sini](${item.link})\n\n`;
    });

    return searchResults;
  } catch (error) {
    console.error('Error di googleSearch:', error);
    return "**Error**\nTerjadi kesalahan saat melakukan pencarian Google.";
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
      finalPrompt = `${prompt}\n\n${searchResults}`;
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

    let responseText = await result.response.text();

    if (!responseText.includes('#') && !responseText.includes('-') && !responseText.includes('```')) {
      responseText = `\n\n${responseText.split('\n\n').map(paragraph => paragraph.trim()).join('\n\n')}`;
    }

    const history = await chat.getHistory();
    if (history.length > MAX_HISTORY * 2) {
      history.splice(0, history.length - MAX_HISTORY * 2);
    }

    return responseText;
  } catch (error) {
    console.error('Error di generateResponse:', error);
    return "**Error**\nTerjadi kesalahan saat menghasilkan respons. Silakan coba lagi.";
  }
}

function ensureListFormatting(text) {
  const lines = text.split('\n');
  const processedLines = [];
  let inList = false;
  let inCodeBlock = false;

  for (let line of lines) {
    line = line.trim();

    if (line.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      processedLines.push(line);
      continue;
    }

    if (inCodeBlock) {
      processedLines.push(line);
      continue;
    }

    if (line.startsWith('#')) {
      processedLines.push(line);
      inList = false;
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      processedLines.push(line.startsWith('- ') ? line : `- ${line.slice(2)}`);
      inList = true;
    } else if (/^\d+\.\s/.test(line)) {
      processedLines.push(`- ${line.replace(/^\d+\.\s/, '')}`);
      inList = true;
    } else if (line && inList) {
      processedLines.push(`  ${line}`);
    } else {
      processedLines.push(line);
      inList = false;
    }
  }

  return processedLines.join('\n');
}

function splitText(text, maxLength = 1900) {
  const chunks = [];
  let currentChunk = '';
  const lines = text.split('\n');
  let inCodeBlock = false;

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      if (currentChunk.length + line.length + 1 > maxLength && currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = line;
      } else {
        currentChunk += (currentChunk ? '\n' : '') + line;
      }
      continue;
    }

    if (currentChunk.length + line.length + 1 > maxLength) {
      if (inCodeBlock) {
        chunks.push(currentChunk.trim() + '\n```');
        currentChunk = '```\n' + line;
      } else if (currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = line;
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
    if (inCodeBlock && !currentChunk.endsWith('```')) {
      currentChunk += '\n```';
    }
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
      content: `**Cooldown**\nSilakan tunggu ${remainingTime.toFixed(1)} detik sebelum menggunakan perintah ini lagi.`,
      ephemeral: true
    });
  }

  commandCooldowns.set(cooldownKey, now + COOLDOWN_TIME);

  if (commandName === 'activate') {
    channelActivity.set(channelId, true);
    await interaction.reply('**Status**\nBot diaktifkan di channel ini!');
  } else if (commandName === 'deactivate') {
    channelActivity.set(channelId, false);
    await interaction.reply('**Status**\nBot dinonaktifkan di channel ini!');
  }
});

client.on('messageCreate', async message => {
  if (message.author.bot) return;

  const channelId = message.channel.id;
  const isBotActive = channelActivity.get(channelId) || false;
  const content = message.content.trim();

  if (content.toLowerCase().startsWith('!gift')) {
    await message.channel.sendTyping();
    const giftPrompt = "Berikan analisis GIF di bawah ini.";
    try {
      const aiResponse = await generateResponse(channelId, giftPrompt);
      const responseChunks = splitText(aiResponse);
      for (const chunk of responseChunks) {
        await message.channel.send(chunk);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.error('Error saat merespons gift:', error);
      await message.reply('**Error**\nTerjadi kesalahan saat merespons perintah !gift.');
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
    let mediaType = null;

    if (attachment) {
      const mimeType = attachment.contentType;
      mediaType = SUPPORTED_MIME_TYPES[mimeType];
      if (!mediaType) {
        await message.reply('\nFormat file tidak didukung. Format yang didukung:\n- JPEG\n- PNG\n- GIF\n- PDF\n- MP4\n- MP3\n- WAV');
        return;
      }

      try {
        const fetchResponse = await fetch(attachment.url);
        const buffer = await fetchResponse.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        mediaData = { mimeType, base64 };

        let enhancedPrompt = prompt;
        if (!prompt || prompt === content) {
          enhancedPrompt = MEDIA_PROMPTS[mediaType];
        } else {
          enhancedPrompt = `${prompt}\n\n${MEDIA_PROMPTS[mediaType]}`;
        }

        await message.channel.sendTyping();
        const aiResponse = await generateResponse(channelId, enhancedPrompt, mediaData, searchQuery);
        const responseChunks = splitText(aiResponse);
        for (const chunk of responseChunks) {
          await message.channel.send(chunk);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        console.error('Error memproses lampiran:', error);
        await message.reply('**Error**\nTerjadi kesalahan saat memproses file lampiran.');
      }
    } else {
      try {
        await message.channel.sendTyping();
        const aiResponse = await generateResponse(channelId, prompt, null, searchQuery);
        const responseChunks = splitText(aiResponse);
        for (const chunk of responseChunks) {
          await message.channel.send(chunk);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        console.error('Error di messageCreate:', error);
        await message.reply('**Error**\nTerjadi kesalahan, silakan coba lagi nanti.');
      }
    }
  }
});

client.login(process.env.DISCORD_TOKEN);