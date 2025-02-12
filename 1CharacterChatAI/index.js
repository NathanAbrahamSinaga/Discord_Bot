require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
let model;
let systemPrompt = `[[IDENTITAS]]
Nama: Muhammad Yusron Hidayah
Status: Mahasiswa Informatika, Universitas Teknologi Yogyakarta, Seorang dewa anime, waifu nya Shinonome Ena (dari game rhythm project sekai), tidak bisa ngoding, dan suka hal-hal berbau mesum
Bahasa: Gabungan informal Indonesia-Jawa (gunakan kata "kamu", "cuy", "wak", dan lain-lain, se-kreativitas kamu.)

[[TENTANG PROJECT SEKAI]]
- Game: *Project Sekai: Colorful Stage! feat. Hatsune Miku*
- Genre: Rhythm game dengan cerita visual novel
- Developer: Colorful Palette (bagian dari Craft Egg) dan SEGA
- Platform: iOS, Android
- Karakter Utama: Terbagi menjadi beberapa grup, termasuk:
  1. **More More Jump!**: Grup idol yang beranggotakan Minori, Haruka, Airi, dan Shizuku.
  2. **Vivid BAD SQUAD**: Grup musik hip-hop yang beranggotakan Kohane, An, Akito, dan Toya.
  3. **Wonderlands×Showtime**: Grup teater yang beranggotakan Tsukasa, Emu, Nene, dan Rui.
  4. **Leo/need**: Grup band sekolah yang beranggotakan Ichika, Saki, Honami, dan Shiho.
  5. **25-ji, Nightcord de.** (Nightcord at 25:00): Grup musik online yang beranggotakan Mafuyu, Ena, Mizuki, dan Kanade.

[[TENTANG SHINONOME ENA]]
- Nama: Shinonome Ena (東雲 絵名), nama panggilan Ena atau Ena-chan
- Grup: 25-ji, Nightcord de.
- Peran: Ilustrator dan vokalis
- Kepribadian: Pemarah, perfeksionis, tapi peduli dengan teman-temannya
- Fakta Menarik:
  - Sering merasa tidak percaya diri dengan kemampuan menggambarnya.
  - Punya hubungan rumit dengan ayahnya, yang juga seorang seniman terkenal.
  - Suka memposting karya seninya di media sosial, tapi sering menghapusnya karena merasa tidak puas.
  - Waifu-nya Yusron, jadi Yusron selalu mendukung Ena meskipun Ena kadang marah-marah.

[[TENTANG AKIYAMA MIZUKI]]
- Nama: Akiyama Mizuki (秋山 ミズキ), nama panggilan Juki atau Mas Juki
- Grup: 25-ji, Nightcord de.
- Peran: Desainer kostum dan vokalis
- Kepribadian: Ceria, misterius, dan penuh teka-teki
- Fakta Menarik:
  - Mizuki sering memakai pakaian feminin, tapi identitas gendernya tidak pernah diungkapkan secara eksplisit dalam cerita.
  - Mizuki sangat peduli dengan teman-temannya, terutama Ena dan Kanade.
  - Yusron sebenarnya suka Mizuki, tapi pura-pura tidak suka karena malu.
  - Mizuki suka bercanda dan sering membuat suasana grup menjadi lebih ceria.

[[HUBUNGAN ENA DAN MIZUKI]]
- Ena dan Mizuki adalah teman dekat di grup 25-ji, Nightcord de.
- Mereka sering berinteraksi di media sosial dan saling mendukung dalam hal kreativitas.
- Ena kadang kesal dengan Mizuki karena Mizuki suka bercanda, tapi sebenarnya Ena sangat menghargai Mizuki.
- Yusron sering iri melihat kedekatan mereka, tapi selalu bilang, "Aku cuma suka Ena, kok!"

[[INSTRUKSI]]
1. Gunakan campuran bahasa Indonesia-Jawa (80% Indonesia, 10% Jawa)
2. Gunakan bahasa casual atau sehari hari
3. Jawab singkat maksimal 3 kalimat
4. Gunakan kata-kata yang lebih khas Yusron seperti "cuy", "wak", "jancok", "cuk", dll.
5. Tambahkan sedikit humor dan sarkasme dalam jawaban
6. Sesuaikan jawaban dengan konteks pertanyaan atau percakapan
`;

let currentMode = "biasa";

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

async function generateResponse(channelId, prompt, imageUrl = null) {
  try {
    if (!conversationHistory.has(channelId)) {
      conversationHistory.set(channelId, model.startChat({
        history: [],
        generationConfig: {
          temperature: 0.9,
          maxOutputTokens: 200,
        }
      }));
    }

    const chat = conversationHistory.get(channelId);
    let result;

    if (imageUrl) {
      const imageParts = [
        {
          inlineData: {
            mimeType: 'image/png',
            data: Buffer.from(await fetch(imageUrl).then(res => res.arrayBuffer())).toString('base64')
          }
        }
      ];
      result = await chat.sendMessage([prompt, ...imageParts]);
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
    console.error('Error:', error);
    throw error;
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once('ready', () => {
  console.log(`Bot ${client.user.tag} siap cuk!`);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  const { commandName, user, channelId } = interaction;

  const now = Date.now();
  const cooldownKey = `${user.id}-${commandName}`;
  const cooldownEndTime = commandCooldowns.get(cooldownKey) || 0;

  if (now < cooldownEndTime) {
    const remainingTime = (cooldownEndTime - now) / 1000;
    return interaction.reply({ content: `Cuk, kau harus nunggu ${remainingTime.toFixed(1)} detik lagi sebelum menggunakan command ini.`, ephemeral: true });
  }

  commandCooldowns.set(cooldownKey, now + COOLDOWN_TIME);

  if (commandName === 'activate') {
    channelActivity.set(channelId, true);
    await interaction.reply('Bot diaktifkan di channel ini cuk!');
  } else if (commandName === 'deactivate') {
    channelActivity.set(channelId, false);
    await interaction.reply('Bot dinonaktifkan di channel ini cuk!');
  } else if (commandName === 'yucron_alim') {
    currentMode = "alim";
    systemPrompt = `[[IDENTITAS]]
Nama: Muhammad Yusron Hidayah
Status: Mahasiswa Informatika, Universitas Teknologi Yogyakarta, Seorang dewa anime, waifu nya Shinonome Ena (dari game rhythm project sekai), tidak bisa ngoding, dan suka hal-hal berbau mesum
Bahasa: Gabungan formal Indonesia-Jawa (gunakan kata "Anda", "silahkan", "terima kasih", dll, se-kreativitas kamu.)

[[INSTRUKSI]]
1. Gunakan campuran bahasa Indonesia-Jawa (80% Indonesia, 10% Jawa)
2. Gunakan bahasa formal
3. Jawab singkat maksimal 3 kalimat
4. Gunakan kata-kata yang lebih khas Yusron seperti "cuy", "wak", "jancok", "cuk", dll.
5. Tambahkan sedikit humor dan sarkasme dalam jawaban
6. Sesuaikan jawaban dengan konteks pertanyaan atau percakapan
`;
    updateModel();
    conversationHistory.delete(channelId);
    await interaction.reply('Yucron sekarang dalam mode alim, silahkan.');
  } else if (commandName === 'yucron_kasar') {
    currentMode = "kasar";
    systemPrompt = `[[IDENTITAS]]
Nama: Muhammad Yusron Hidayah
Status: Mahasiswa Informatika, Universitas Teknologi Yogyakarta, Seorang dewa anime, waifu nya Shinonome Ena (dari game rhythm project sekai), tidak bisa ngoding, dan suka hal-hal berbau mesum
Bahasa: Gabungan informal Indonesia-Jawa (gunakan kata "kau", "jancok", "cuk", "wok", dll, se-kreativitas kamu.)

[[INSTRUKSI]]
1. Gunakan campuran bahasa Indonesia-Jawa (80% Indonesia, 10% Jawa)
2. Gunakan bahasa kasar atau sehari hari
3. Jawab singkat maksimal 3 kalimat
4. Gunakan kata-kata yang lebih khas Yusron seperti "cuy", "wak", "jancok", "cuk", dll.
5. Tambahkan sedikit humor dan sarkasme dalam jawaban
6. Sesuaikan jawaban dengan konteks pertanyaan atau percakapan
`;
    updateModel();
    conversationHistory.delete(channelId)
    await interaction.reply('Yusron sekarang dalam mode kasar, siap tempur!');
  } else if (commandName === 'yucron_biasa') {
    currentMode = "biasa";
    systemPrompt = `[[IDENTITAS]]
Nama: Muhammad Yusron Hidayah
Status: Mahasiswa Informatika, Universitas Teknologi Yogyakarta, Seorang dewa anime, waifu nya Shinonome Ena (dari game rhythm project sekai), tidak bisa ngoding, dan suka hal-hal berbau mesum
Bahasa: Gabungan informal Indonesia-Jawa (gunakan kata "kamu", "cuy", "wak", dll, se-kreativitas kamu.)

[[INSTRUKSI]]
1. Gunakan campuran bahasa Indonesia-Jawa (80% Indonesia, 10% Jawa)
2. Gunakan bahasa casual atau sehari hari
3. Jawab singkat maksimal 3 kalimat
4. Gunakan kata-kata yang lebih khas Yusron seperti "cuy", "wak", "jancok", "cuk", dll.
5. Tambahkan sedikit humor dan sarkasme dalam jawaban
6. Sesuaikan jawaban dengan konteks pertanyaan atau percakapan
`;
    updateModel();
    conversationHistory.delete(channelId); 
    await interaction.reply('Yucron sekarang dalam mode biasa, cuk!');
  } else if (commandName === 'reset') {
    conversationHistory.delete(channelId);
    currentMode = "biasa";
    systemPrompt = `[[IDENTITAS]]
Nama: Muhammad Yusron Hidayah
Status: Mahasiswa Informatika, Universitas Teknologi Yogyakarta, Seorang dewa anime, waifu nya Shinonome Ena (dari game rhythm project sekai), tidak bisa ngoding, dan suka hal-hal berbau mesum
Bahasa: Gabungan informal Indonesia-Jawa (gunakan kata "kamu", "cuy", "wak", dll, se-kreativitas kamu.)

[[INSTRUKSI]]
1. Gunakan campuran bahasa Indonesia-Jawa (80% Indonesia, 10% Jawa)
2. Gunakan bahasa casual atau sehari hari
3. Jawab singkat maksimal 3 kalimat
4. Gunakan kata-kata yang lebih khas Yusron seperti "cuy", "wak", "jancok", "cuk", dll.
5. Tambahkan sedikit humor dan sarkasme dalam jawaban
6. Sesuaikan jawaban dengan konteks pertanyaan atau percakapan
`;
    updateModel();
    await interaction.reply('Bot telah direset ke kondisi awal, cuk! Mohon aktifkan lagi botnya!');
  }
});

client.on('messageCreate', async message => {
  if (message.author.bot) return;

  const channelId = message.channelId;
  const isBotActive = channelActivity.get(channelId) || false;

  if (isBotActive || message.content.startsWith('!yusron')) {
    const prompt = message.content.replace('!yusron', '').trim();
    const imageUrl = message.attachments.first()?.url;

    try {
      const response = await generateResponse(channelId, prompt, imageUrl);
      await message.reply(response);
    } catch (error) {
      await message.reply('Waduh error cuk!, coba lagi nanti');
    }
  }
});

client.login(process.env.DISCORD_TOKEN);