import os
import sys
import torch
import discord
from discord.ext import commands
import soundfile as sf
import asyncio
import google.generativeai as genai
from deep_translator import GoogleTranslator
from tools.i18n.i18n import I18nAuto
from GPT_SoVITS.inference_webui import change_gpt_weights, change_sovits_weights, get_tts_wav
from dotenv import load_dotenv

load_dotenv()

os.environ["language"] = "ja"
i18n = I18nAuto(language="ja")

models = {
    "Mita": {
        "GPT_MODEL_PATH": "../Models/Mita/MitaMiside-e15.ckpt",
        "SOVITS_MODEL_PATH": "../Models/Mita/MitaMiside_e8_s352.pth",
        "REF_WAV_PATH": "../Models/Mita/audio8.wav",
        "PROMPT_TEXT": "でも、私のチビちゃんたちはどこかおかしいみたいで。"
    },
    "Emu": {
        "GPT_MODEL_PATH": "../Models/Emu_Otori/EmuOtori-e15.ckpt",
        "SOVITS_MODEL_PATH": "../Models/Emu_Otori/EmuOtori_e8_s352.pth",
        "REF_WAV_PATH": "../Models/Emu_Otori/emu8.wav",
        "PROMPT_TEXT": "あの時は、ねねちゃんたちに手伝ってもらったし、また一緒にやろうよって誘っちゃおっかなー。"
    }
}

selected_character = "Emu"
REF_WAV_PATH = models[selected_character]["REF_WAV_PATH"]
PROMPT_TEXT = models[selected_character]["PROMPT_TEXT"]
PROMPT_LANGUAGE = "日文"
TEXT_LANGUAGE = "日文"

def set_model(character):
    global REF_WAV_PATH, PROMPT_TEXT
    if character in models:
        try:
            change_gpt_weights(gpt_path=models[character]["GPT_MODEL_PATH"])
            change_sovits_weights(sovits_path=models[character]["SOVITS_MODEL_PATH"])
            REF_WAV_PATH = models[character]["REF_WAV_PATH"]
            PROMPT_TEXT = models[character]["PROMPT_TEXT"]
            print(f"Menggunakan karakter {character}")
        except Exception as e:
            print(f"Gagal memuat model untuk {character}: {e}")
    else:
        print(f"Karakter {character} tidak ditemukan.")

def generate_audio(text):
    try:
        synthesis_result = get_tts_wav(
            ref_wav_path=REF_WAV_PATH,
            prompt_text=PROMPT_TEXT,
            prompt_language=i18n(PROMPT_LANGUAGE),
            text=text,
            text_language=i18n(TEXT_LANGUAGE)
        )
        result_list = list(synthesis_result)
        if result_list:
            last_sampling_rate, last_audio_data = result_list[-1]
            return last_sampling_rate, last_audio_data
        return None, None
    except Exception as e:
        print(f"Error generating audio: {e}")
        return None, None

genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
model = genai.GenerativeModel('gemini-2.0-flash')
translator = GoogleTranslator(source='ja', target='en')

async def generate_response_with_history(channel, user_message):
    try:
        history = []
        async for msg in channel.history(limit=10):
            history.append(f"{msg.author.name}: {msg.content}")
        history.reverse()

        prompt = (
            f"[JA] あなたは「{selected_character}」という日本語を話すキャラクターです。"
            "以下の会話の履歴を参考に、最新のメッセージに自然で会話的な日本語で応答してください。"
            "ユーザーのメッセージを直接引用せず、また「」や絵文字を使わずに自然な会話の流れを保ってください。"
            "また、「うーん」は使用せず、代わりに「うん」を使ってください。"
            "5文以内で答えてください。\n\n"
            "会話履歴:\n" + "\n".join(history) + f"\n\n最新のメッセージ: {user_message}"
        )

        response = model.generate_content(prompt)
        japanese_response = response.text.strip()
        english_response = translator.translate(japanese_response)
        return japanese_response, english_response
    except Exception as e:
        print(f"Error generating response: {e}")
        return "ごめん、応答が作れなかったよ。", "Sorry, I couldn't generate a response."

intents = discord.Intents.default()
intents.message_content = True
bot = commands.Bot(command_prefix='!', intents=intents)

@bot.event
async def on_ready():
    print(f'Bot telah login sebagai {bot.user}')
    set_model(selected_character)
    try:
        synced = await bot.tree.sync()
        print(f"Sinkronasi {len(synced)} slash command(s)")
    except Exception as e:
        print(f"Gagal sinkronasi slash commands: {e}")

@bot.tree.command(name="mita")
async def mita(interaction: discord.Interaction):
    global selected_character
    selected_character = "Mita"
    set_model(selected_character)
    await interaction.response.send_message("Sekarang menggunakan karakter Mita (ミタ)")

@bot.tree.command(name="otori_emu")
async def emu(interaction: discord.Interaction):
    global selected_character
    selected_character = "Emu"
    set_model(selected_character)
    await interaction.response.send_message("Sekarang menggunakan karakter Otori Emu (鳳えむ)")

@bot.command()
async def chat(ctx, *, text: str):
    if not text:
        await ctx.send("Harap masukkan teks setelah !chat, contoh: `!chat halo, apa kabar?`")
        return

    wait_message = await ctx.send("Tunggu sebentar...")
    japanese_response, english_response = await generate_response_with_history(ctx.channel, text)
    sampling_rate, audio_data = await asyncio.to_thread(generate_audio, japanese_response)
    
    response_message = f"{japanese_response}\n{english_response}"
    await ctx.send(response_message)
    
    if audio_data is None:
        await ctx.send("Gagal membuat suara. Coba lagi ya.")
        await wait_message.delete()
        return

    temp_file = "temp_audio.wav"
    sf.write(temp_file, audio_data, sampling_rate)

    try:
        with open(temp_file, 'rb') as f:
            await ctx.send(file=discord.File(f, 'audio.wav'))
    except Exception as e:
        await ctx.send(f"Gagal mengirim suara: {e}")
    finally:
        if os.path.exists(temp_file):
            os.remove(temp_file)
        await wait_message.delete()

@bot.command()
async def audio(ctx, *, text: str):
    if not text:
        await ctx.send("Harap masukkan teks dalam bahasa Jepang setelah !audio, contoh: `!audio こんにちは`")
        return

    wait_message = await ctx.send("Tunggu sebentar...")
    sampling_rate, audio_data = await asyncio.to_thread(generate_audio, text)
    if audio_data is None:
        await ctx.send("Gagal membuat suara. Coba lagi ya.")
        await wait_message.delete()
        return

    temp_file = "temp_audio.wav"
    sf.write(temp_file, audio_data, sampling_rate)

    try:
        with open(temp_file, 'rb') as f:
            await ctx.send(file=discord.File(f, 'audio.wav'))
    except Exception as e:
        await ctx.send(f"Gagal mengirim suara: {e}")
    finally:
        if os.path.exists(temp_file):
            os.remove(temp_file)
        await wait_message.delete()

@bot.event
async def on_message(message):
    if message.author == bot.user or message.author.bot:
        return
    if bot.user in message.mentions:
        content = message.content.replace(f"<@{bot.user.id}>", "").strip()
        if content:
            await message.channel.typing()
            wait_message = await message.channel.send("Tunggu sebentar...")
            japanese_response, english_response = await generate_response_with_history(message.channel, content)
            response_message = f"{japanese_response}\n{english_response}"
            await message.channel.send(response_message)
            
            sampling_rate, audio_data = await asyncio.to_thread(generate_audio, japanese_response)
            if audio_data is not None:
                temp_file = "temp_audio.wav"
                sf.write(temp_file, audio_data, sampling_rate)
                try:
                    with open(temp_file, 'rb') as f:
                        await message.channel.send(file=discord.File(f, 'audio.wav'))
                except Exception as e:
                    await message.channel.send(f"Gagal mengirim suara: {e}")
                finally:
                    if os.path.exists(temp_file):
                        os.remove(temp_file)
                    await wait_message.delete()
            else:
                await message.channel.send("Gagal membuat suara.")
                await wait_message.delete()
    await bot.process_commands(message)

if __name__ == "__main__":
    TOKEN = os.getenv("DISCORD_BOT_TOKEN")
    if TOKEN is None:
        print("Error: Token tidak ada atau tidak valid")
        sys.exit(1)
    bot.run(TOKEN)