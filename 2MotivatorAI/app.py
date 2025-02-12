import os
os.environ["TF_ENABLE_ONEDNN_OPTS"] = "0"

import discord
from discord.ext import commands
from transformers import pipeline, AutoTokenizer, AutoModelForSequenceClassification
import asyncio
from google import genai

intents = discord.Intents.default()
intents.messages = True
intents.message_content = True

bot = commands.Bot(command_prefix="!", intents=intents)

channel_auto_response = {}

pretrained = "thoriqfy/indobert-emotion-classification"
model = AutoModelForSequenceClassification.from_pretrained(pretrained)
tokenizer = AutoTokenizer.from_pretrained(pretrained)
emotion_classifier = pipeline("text-classification", model=model, tokenizer=tokenizer)

label_index = {
    'Anger': 'anger',
    'Fear': 'fear',
    'Joy': 'joy',
    'Love': 'love',
    'Sadness': 'sad',
    'Neutral': 'neutral'
}

GEMINI_API_KEY = "Your_API_Key"
client = genai.Client(api_key=GEMINI_API_KEY)

def generate_motivational_message(emotion, user_message=None):
    if user_message:
        user_msg_text = f"dengan pesan: \"{user_message}\" "
    else:
        user_msg_text = ""
    prompt = (
        f"Buatlah pesan motivasi dalam bahasa Indonesia casual yang inspiratif dan menghibur "
        f"{user_msg_text}untuk seseorang yang sedang merasa {emotion}. Sertakan pesan positif yang memotivasi "
        f"untuk terus berjuang dan percaya pada diri sendiri. Hanya boleh menggunakan maksimal 5 kalimat."
    )
    response = client.models.generate_content(
        model="gemini-2.0-flash",
        contents=[prompt],
    )
    return response.text

@bot.event
async def on_ready():
    print(f"{bot.user} telah online dan siap digunakan.")
    try:
        synced = await bot.tree.sync()
        print(f"Synced {len(synced)} commands.")
    except Exception as e:
        print(e)

@bot.event
async def on_message(message):
    if message.author == bot.user:
        return

    if channel_auto_response.get(message.channel.id, False):
        print(f"Pesan diterima dari {message.author} di channel {message.channel.id}: {message.content}")
        analysis = emotion_classifier(message.content)
        result = analysis[0]
        print("Hasil analisis:", result)
        emotion = label_index.get(result['label'], result['label'])
        score = result['score']
        if emotion in ["sad", "fear", "anger"] and score > 0.5:
            loop = asyncio.get_event_loop()
            motivational_text = await loop.run_in_executor(None, generate_motivational_message, emotion, message.content)
            await message.channel.send(motivational_text)

    await bot.process_commands(message)

@bot.tree.command(name="motivate", description="Memanggil pesan motivasi manual")
async def motivate(interaction: discord.Interaction):
    await interaction.response.defer()
    loop = asyncio.get_event_loop()
    motivational_text = await loop.run_in_executor(None, generate_motivational_message, "sad", "")
    await interaction.followup.send(motivational_text)

@bot.tree.command(name="activate", description="Aktifkan fitur auto-response di channel ini")
async def activate(interaction: discord.Interaction):
    channel_auto_response[interaction.channel.id] = True
    await interaction.response.send_message("Fitur auto-response telah diaktifkan di channel ini.")

@bot.tree.command(name="deactivate", description="Nonaktifkan fitur auto-response di channel ini")
async def deactivate(interaction: discord.Interaction):
    channel_auto_response[interaction.channel.id] = False
    await interaction.response.send_message("Fitur auto-response telah dinonaktifkan di channel ini.")

bot.run("Your_Discord_Token")
