require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fetch = require('node-fetch');
const cheerio = require('cheerio');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
let defaultModel;
let thinkingModel;

const systemPrompt = `
Jawab dengan bahasa Indonesia. Pastikan output rapi dan mudah dibaca di Discord menggunakan format Markdown:
- Gunakan # untuk heading besar, ## untuk subheading.
- Gunakan - untuk bullet point pada list.
- Gunakan ** untuk teks tebal, * untuk italic.
- Gunakan \`\`\` untuk blok kode (contoh: \`\`\`javascript).
- Pisahkan paragraf dengan baris kosong.
- Batasi pesan agar tidak melebihi 2000 karakter.
`;

function updateModels() {
  defaultModel = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    systemInstruction: {
      role: 'model',
      parts: [{ text: systemPrompt }]
    }
  });

  thinkingModel = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash-thinking-exp',
    systemInstruction: {
      role: 'model',
      parts: [{ text: systemPrompt }]
    }
  });
}
updateModels();

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

async function fetchWebContent(url) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DiscordBot/1.0)'
      }
    });
    if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
    const html = await response.text();
    const $ = cheerio.load(html);

    let content = '';
    $('p, h1, h2, h3').each((i, elem) => {
      content += $(elem).text().trim() + '\n';
    });

    return content.slice(0, 5000);
  } catch (error) {
    console.error('Error di fetchWebContent:', error);
    return `**Error Scraping**\nGagal mengambil konten dari ${url}.`;
  }
}

async function googleSearch(query) {
  try {
    const url = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CSE_ID}&q=${encodeURIComponent(query)}&num=5&lr=lang_id&gl=id`;
    const response = await fetch(url);

    if (!response.ok) {
      const errorText = await response.text();
      return `**Error Pencarian**\nMaaf, terjadi kesalahan saat mengakses API Google.\n- Status: ${response.status}\n- Pesan: ${errorText}`;
    }

    const data = await response.json();
    if (!data.items || data.items.length === 0) {
      return "**Hasil Pencarian**\nMaaf, tidak ada hasil yang ditemukan untuk pencarian ini.";
    }

    const firstUrl = data.items[0].link;
    const webContent = await fetchWebContent(firstUrl);

    let searchResults = "**Hasil Pencarian dari Google**\n\n";
    data.items.forEach((item, index) => {
      searchResults += `- **${index + 1}. ${item.title}**\n`;
      searchResults += `  ${item.snippet}\n`;
      searchResults += `  Sumber: [Klik di sini](${item.link})\n\n`;
    });

    searchResults += `**Konten dari ${firstUrl}**\n${webContent}\n`;
    return searchResults;
  } catch (error) {
    console.error('Error di googleSearch:', error);
    return "**Error**\nTerjadi kesalahan saat melakukan pencarian Google.";
  }
}

async function generateResponse(channelId, prompt, mediaData = null, searchQuery = null, useThinking = false) {
  try {
    const selectedModel = useThinking ? thinkingModel : defaultModel;

    if (!conversationHistory.has(channelId)) {
      conversationHistory.set(channelId, selectedModel.startChat({
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
      const textPart = prompt ? { text: prompt } : null;
      const mediaPart = { inlineData: { mimeType: mediaData.mimeType, data: mediaData.base64 } };
      const parts = [mediaPart];
      if (textPart) parts.unshift(textPart);
      result = await chat.sendMessage(parts);
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

  // Bagian Ditambahkan: Fitur !reset
  if (content.toLowerCase() === '!reset') {
    if (conversationHistory.has(channelId)) {
      conversationHistory.delete(channelId); // Menghapus riwayat percakapan untuk channel ini
      await message.channel.send('Riwayat percakapan di channel ini telah direset!');
    } else {
      await message.channel.send('Tidak ada riwayat percakapan yang perlu dihapus');
    }
    return;
  }

  if (content.toLowerCase().startsWith('!think')) {
    await message.channel.sendTyping();
    const thinkingPrompt = content.replace('!think', '').trim();
    try {
      const aiResponse = await generateResponse(channelId, thinkingPrompt, null, null, true); 
      const responseChunks = splitText(aiResponse);
      for (const chunk of responseChunks) {
        await message.channel.send(chunk);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.error('Error saat merespons thinking:', error);
      await message.reply('**Error**\nTerjadi kesalahan saat merespons perintah !think.');
    }
    return;
  }

  if (content.toLowerCase().startsWith('!gift')) {
    await message.channel.sendTyping();
    const giftPrompt = content.replace('!gift', '').trim();
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

    if (attachment) {
      const mimeType = attachment.contentType;
      if (!SUPPORTED_MIME_TYPES[mimeType]) {
        await message.reply('\nFormat file tidak didukung. Format yang didukung:\n- JPEG\n- PNG\n- GIF\n- PDF\n- MP4\n- MP3\n- WAV');
        return;
      }

      try {
        const fetchResponse = await fetch(attachment.url);
        const buffer = await fetchResponse.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        mediaData = { mimeType, base64 };

        await message.channel.sendTyping();
        const aiResponse = await generateResponse(channelId, prompt, mediaData, searchQuery);
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