import os
import base64
import asyncio
import io
from dotenv import load_dotenv
from discord import Client, Intents, Interaction, File, app_commands, Attachment
from discord.ext import commands
import google.genai as genai
import google.genai.types as types
import requests
from bs4 import BeautifulSoup
import pathlib
from PIL import Image

load_dotenv()

client = genai.Client(api_key=os.getenv('GEMINI_API_KEY'))
GOOGLE_API_KEY = os.getenv('GOOGLE_API_KEY')
GOOGLE_CSE_ID = os.getenv('GOOGLE_CSE_ID')

system_prompt = """
Jawab dengan bahasa Indonesia. Pastikan output rapi dan mudah dibaca di Discord menggunakan format Markdown:
- Gunakan # untuk heading besar, ## untuk subheading.
- Gunakan - untuk bullet point pada list.
- Gunakan ** untuk teks tebal, * untuk italic.
- Gunakan ``` untuk blok kode (contoh: ```python).
- Pisahkan paragraf dengan baris kosong.
- Batasi pesan agar tidak melebihi 2000 karakter.
"""

conversation_history = {}
image_history = {}
command_cooldowns = {}
channel_activity = {}
MAX_HISTORY = 10
COOLDOWN_TIME = 30000

SUPPORTED_MIME_TYPES = {
    'image/jpeg': 'image',
    'image/png': 'image',
    'image/gif': 'image',
    'application/pdf': 'pdf',
    'video/mp4': 'video',
    'video/mpeg': 'video',
    'audio/mp3': 'audio',
    'audio/mpeg': 'audio',
    'audio/wav': 'audio',
    'image/jpg': 'image'
}

async def fetch_web_content(url):
    try:
        headers = {'User-Agent': 'Mozilla/5.0 (compatible; DiscordBot/1.0)'}
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(None, lambda: requests.get(url, headers=headers))
        response.raise_for_status()
        html = response.text
        
        def parse_html():
            soup = BeautifulSoup(html, 'html.parser')
            content = ""
            for elem in soup.select('p, h1, h2, h3'):
                content += elem.get_text().strip() + '\n'
            return content[:5000]
            
        content = await loop.run_in_executor(None, parse_html)
        return content
    except Exception as error:
        print(f'Error di fetchWebContent: {error}')
        return f"**Error Scraping**\nGagal mengambil konten dari {url}."

async def translate_text(text, target_language='en'):
    try:
        url = f"https://translation.googleapis.com/language/translate/v2?key={GOOGLE_API_KEY}"
        payload = {
            'q': text,
            'target': target_language,
            'format': 'text'
        }
        
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            None, 
            lambda: requests.post(url, json=payload)
        )
        response.raise_for_status()
        
        result = response.json()
        translated_text = result['data']['translations'][0]['translatedText']
        return translated_text
    except Exception as error:
        print(f'Error di translateText: {error}')
        return text

async def google_search(query):
    try:
        url = f"https://www.googleapis.com/customsearch/v1?key={GOOGLE_API_KEY}&cx={GOOGLE_CSE_ID}&q={query}&num=5&lr=lang_id&gl=id"
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(None, lambda: requests.get(url))
        response.raise_for_status()
        
        data = response.json()
        if not data.get('items'):
            return "**Hasil Pencarian**\nMaaf, tidak ada hasil yang ditemukan untuk pencarian ini."

        first_url = data['items'][0]['link']
        web_content = await fetch_web_content(first_url)

        search_results = "**Hasil Pencarian dari Google**\n\n"
        for index, item in enumerate(data['items']):
            search_results += f"- **{index + 1}. {item['title']}**\n"
            search_results += f"  {item['snippet']}\n"
            search_results += f"  Sumber: [Klik di sini]({item['link']})\n\n"

        search_results += f"**Konten dari {first_url}**\n{web_content}\n"
        return search_results
    except Exception as error:
        print(f'Error di googleSearch: {error}')
        return "**Error**\nTerjadi kesalahan saat melakukan pencarian Google."

async def generate_response(channel_id, prompt, media_data=None, search_query=None, use_thinking=False):
    try:
        model_name = "gemini-2.0-flash-thinking-exp" if use_thinking else "gemini-2.0-flash"
        
        if channel_id not in conversation_history:
            conversation_history[channel_id] = client.chats.create(
                model=model_name,
                config=types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    temperature=0.9,
                    max_output_tokens=4000
                )
            )
        
        chat = conversation_history[channel_id]
        contents = [prompt]

        if search_query:
            search_results = await google_search(search_query)
            contents.append(search_results)

        if media_data:
            if media_data['mime_type'] == 'application/pdf':
                pdf_buffer = base64.b64decode(media_data['base64'])
                pdf_file = client.files.upload(file=io.BytesIO(pdf_buffer), config=dict(mime_type='application/pdf'))
                contents.append(pdf_file)
            else:
                contents.append(types.Part.from_bytes(
                    data=base64.b64decode(media_data['base64']),
                    mime_type=media_data['mime_type']
                ))

        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            None,
            lambda: chat.send_message(contents)
        )
        
        response_text = response.text
        if not any(marker in response_text for marker in ['#', '-', '```']):
            paragraphs = [p.strip() for p in response_text.split('\n\n')]
            response_text = '\n\n' + '\n\n'.join(paragraphs)
        
        return response_text
    except Exception as error:
        print(f'Error di generateResponse: {error}')
        return "**Error**\nTerjadi kesalahan saat menghasilkan respons. Silakan coba lagi."

async def generate_image(channel_id, prompt, use_english=False):
    try:
        model_name = "gemini-2.0-flash-exp"
        
        image_prompt = prompt
        if use_english:
            image_prompt = prompt
        
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            None,
            lambda: client.models.generate_content(
                model=model_name,
                contents=image_prompt,
                config=types.GenerateContentConfig(
                    response_modalities=['Text', 'Image'],
                    temperature=0.9
                )
            )
        )
        
        image_data = None
        image_response_text = None
        
        for part in response.candidates[0].content.parts:
            if part.text is not None:
                image_response_text = part.text
            elif part.inline_data is not None and part.inline_data.mime_type.startswith('image/'):
                image_data = part.inline_data.data
        
        if image_data:
            image_history[channel_id] = image_data
            
            img_buffer = io.BytesIO(image_data)
            img_buffer.seek(0)
            
            response_text = "Gambar Dibuat" if not use_english else "Image Created"
            
            return img_buffer, image_response_text or response_text
        else:
            error_text = "**Error**\nTidak dapat menghasilkan gambar. Silakan coba prompt yang berbeda."
            if use_english:
                error_text = "**Error**\nUnable to generate image. Please try a different prompt."
            return None, error_text
        
    except Exception as error:
        print(f'Error di generateImage: {error}')
        error_text = f"**Error**\nTerjadi kesalahan saat menghasilkan gambar: {str(error)}"
        if use_english:
            error_text = f"**Error**\nAn error occurred while generating the image: {str(error)}"
        return None, error_text

async def edit_image(channel_id, prompt, image_data, use_english=False):
    try:
        model_name = "gemini-2.0-flash-exp"
        
        edit_prompt = prompt
        if use_english:
            edit_prompt = prompt
        
        image_buffer = io.BytesIO(image_data)
        pil_image = Image.open(image_buffer)
        
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            None,
            lambda: client.models.generate_content(
                model=model_name,
                contents=[edit_prompt, types.Part.from_bytes(data=image_data, mime_type="image/png")],
                config=types.GenerateContentConfig(
                    response_modalities=['Text', 'Image'],
                    temperature=0.9
                )
            )
        )
        
        edited_image_data = None
        edit_response_text = None
        
        for part in response.candidates[0].content.parts:
            if part.text is not None:
                edit_response_text = part.text
            elif part.inline_data is not None and part.inline_data.mime_type.startswith('image/'):
                edited_image_data = part.inline_data.data
        
        if edited_image_data:
            image_history[channel_id] = edited_image_data
            
            img_buffer = io.BytesIO(edited_image_data)
            img_buffer.seek(0)
            
            response_text = "Gambar Berhasil Diedit" if not use_english else "Image Successfully Edited"
            
            return img_buffer, edit_response_text or response_text
        else:
            error_text = "**Error**\nTidak dapat mengedit gambar. Silakan coba prompt yang berbeda."
            if use_english:
                error_text = "**Error**\nUnable to edit the image. Please try a different prompt."
            return None, error_text
        
    except Exception as error:
        print(f'Error di editImage: {error}')
        error_text = f"**Error**\nTerjadi kesalahan saat mengedit gambar: {str(error)}"
        if use_english:
            error_text = f"**Error**\nAn error occurred while editing the image: {str(error)}"
        return None, error_text

def split_text(text, max_length=1900):
    chunks = []
    current_chunk = ''
    lines = text.split('\n')
    in_code_block = False
    current_language = ''

    for line in lines:
        trimmed_line = line.strip()

        if trimmed_line.startswith('```'):
            if not in_code_block:
                current_language = trimmed_line.replace('```', '')
                in_code_block = True
            else:
                in_code_block = False
            current_chunk += ('\n' if current_chunk else '') + line
            continue

        if in_code_block:
            if len(current_chunk) + len(line) + 1 > max_length:
                current_chunk += '\n```'
                chunks.append(current_chunk.strip())
                current_chunk = f"```{current_language}\n{line}"
            else:
                current_chunk += ('\n' if current_chunk else '') + line
        else:
            if len(line) > max_length:
                parts = [line[i:i+max_length] for i in range(0, len(line), max_length)]
                for part in parts:
                    if len(current_chunk) + len(part) + 1 > max_length:
                        chunks.append(current_chunk.strip())
                        current_chunk = part
                    else:
                        current_chunk += ('\n' if current_chunk else '') + part
            elif len(current_chunk) + len(line) + 1 > max_length:
                chunks.append(current_chunk.strip())
                current_chunk = line
            else:
                current_chunk += ('\n' if current_chunk else '') + line

    if current_chunk:
        if in_code_block and not current_chunk.endswith('```'):
            current_chunk += '\n```'
        chunks.append(current_chunk.strip())

    return chunks

intents = Intents.default()
intents.message_content = True
bot = commands.Bot(command_prefix='!', intents=intents)

@bot.event
async def on_ready():
    print(f'Bot {bot.user} siap!')
    try:
        synced = await bot.tree.sync()
        print(f"Synced {len(synced)} command(s)")
    except Exception as e:
        print(f"Failed to sync commands: {e}")

@bot.tree.command(name="activate", description="Mengaktifkan bot di channel ini")
async def activate(interaction: Interaction):
    channel_id = str(interaction.channel_id)
    user_id = str(interaction.user.id)
    now = asyncio.get_event_loop().time() * 1000
    
    cooldown_key = f"{user_id}-activate"
    cooldown_end_time = command_cooldowns.get(cooldown_key, 0)
    
    if now < cooldown_end_time:
        remaining_time = (cooldown_end_time - now) / 1000
        await interaction.response.send_message(
            f"**Cooldown**\nSilakan tunggu {remaining_time:.1f} detik sebelum menggunakan perintah ini lagi.",
            ephemeral=True
        )
        return
    
    command_cooldowns[cooldown_key] = now + COOLDOWN_TIME
    channel_activity[channel_id] = True
    await interaction.response.send_message("**Status**\nBot diaktifkan di channel ini!")

@bot.tree.command(name="deactivate", description="Menonaktifkan bot di channel ini")
async def deactivate(interaction: Interaction):
    channel_id = str(interaction.channel_id)
    user_id = str(interaction.user.id)
    now = asyncio.get_event_loop().time() * 1000
    
    cooldown_key = f"{user_id}-deactivate"
    cooldown_end_time = command_cooldowns.get(cooldown_key, 0)
    
    if now < cooldown_end_time:
        remaining_time = (cooldown_end_time - now) / 1000
        await interaction.response.send_message(
            f"**Cooldown**\nSilakan tunggu {remaining_time:.1f} detik sebelum menggunakan perintah ini lagi.",
            ephemeral=True
        )
        return
    
    command_cooldowns[cooldown_key] = now + COOLDOWN_TIME
    channel_activity[channel_id] = False
    await interaction.response.send_message("**Status**\nBot dinonaktifkan di channel ini!")

@bot.event
async def on_message(message):
    if message.author.bot:
        return

    channel_id = str(message.channel.id)
    is_bot_active = channel_activity.get(channel_id, False)
    content = message.content.strip()

    if content.lower() == '!reset':
        if channel_id in conversation_history:
            conversation_history.pop(channel_id)
            await message.channel.send('Riwayat percakapan di channel ini telah direset!')
        else:
            await message.channel.send('Tidak ada riwayat percakapan yang perlu dihapus')
        return
    
    if content.lower() == '!resetgambar':
        if channel_id in image_history:
            image_history.pop(channel_id)
            await message.channel.send('Riwayat gambar di channel ini telah direset!')
        else:
            await message.channel.send('Tidak ada riwayat gambar yang perlu dihapus')
        return

    if content.lower().startswith('!gambar'):
        async with message.channel.typing():
            image_prompt = content.replace('!gambar', '', 1).strip()
            
            if not image_prompt:
                await message.reply('**Error**\nGunakan format: !gambar [deskripsi gambar yang diinginkan]')
                return
            
            img_buffer, response_text = await generate_image(channel_id, image_prompt, use_english=False)
            
            if img_buffer:
                await message.channel.send(
                    f"**{response_text}**\nBerdasarkan prompt: {image_prompt}", 
                    file=File(fp=img_buffer, filename='generated_image.png')
                )
            else:
                await message.channel.send(response_text)
        return
        
    if content.lower().startswith('!gambar_en'):
        async with message.channel.typing():
            image_prompt = content.replace('!gambar_en', '', 1).strip()
            
            if not image_prompt:
                await message.reply('**Error**\nUse format: !gambar_en [desired image description]')
                return
            
            img_buffer, response_text = await generate_image(channel_id, image_prompt, use_english=True)
            
            if img_buffer:
                await message.channel.send(
                    f"**{response_text}**\nBased on prompt: {image_prompt}", 
                    file=File(fp=img_buffer, filename='generated_image.png')
                )
            else:
                await message.channel.send(response_text)
        return
    
    if content.lower().startswith('!editgambar'):
        async with message.channel.typing():
            edit_prompt = content.replace('!editgambar', '', 1).strip()
            attachment = message.attachments[0] if message.attachments else None
            
            if attachment:
                if not attachment.content_type.startswith('image/'):
                    await message.reply('**Error**\nHanya file gambar yang dapat diedit!')
                    return
                
                loop = asyncio.get_event_loop()
                response = await loop.run_in_executor(None, lambda: requests.get(attachment.url))
                image_data = response.content
            elif channel_id in image_history:
                image_data = image_history[channel_id]
            else:
                await message.reply('**Error**\nGunakan format: !editgambar [deskripsi edit] dengan melampirkan gambar!')
                return
            
            if not edit_prompt:
                await message.reply('**Error**\nGunakan format: !editgambar [deskripsi edit] dengan melampirkan gambar!')
                return
            
            edited_img_buffer, edit_response_text = await edit_image(channel_id, edit_prompt, image_data, use_english=False)
            
            if edited_img_buffer:
                await message.channel.send(
                    f"**{edit_response_text}**\nBerdasarkan prompt: {edit_prompt}", 
                    file=File(fp=edited_img_buffer, filename='edited_image.png')
                )
            else:
                await message.channel.send(edit_response_text)
        return
    
    if content.lower().startswith('!editgambar_en'):
        async with message.channel.typing():
            edit_prompt = content.replace('!editgambar_en', '', 1).strip()
            attachment = message.attachments[0] if message.attachments else None
            
            if attachment:
                if not attachment.content_type.startswith('image/'):
                    await message.reply('**Error**\nOnly image files can be edited!')
                    return
                
                loop = asyncio.get_event_loop()
                response = await loop.run_in_executor(None, lambda: requests.get(attachment.url))
                image_data = response.content
            elif channel_id in image_history:
                image_data = image_history[channel_id]
            else:
                await message.reply('**Error**\nUse format: !editgambar_en [edit description] with an attached image!')
                return
            
            if not edit_prompt:
                await message.reply('**Error**\nUse format: !editgambar_en [edit description] with an attached image!')
                return

            edited_img_buffer, edit_response_text = await edit_image(channel_id, edit_prompt, image_data, use_english=True)
            
            if edited_img_buffer:
                await message.channel.send(
                    f"**{edit_response_text}**\nBased on prompt: {edit_prompt}", 
                    file=File(fp=edited_img_buffer, filename='edited_image.png')
                )
            else:
                await message.channel.send(edit_response_text)
        return

    if content.lower().startswith('!think'):
        async with message.channel.typing():
            thinking_prompt = content.replace('!think', '', 1).strip()
            attachment = message.attachments[0] if message.attachments else None
            media_data = None

            if attachment:
                mime_type = attachment.content_type
                if mime_type not in SUPPORTED_MIME_TYPES:
                    await message.reply('\nFormat file tidak didukung. Format yang didukung:\n- JPEG\n- JPG\n- PNG\n- GIF\n- PDF\n- MP4\n- MP3\n- WAV')
                    return

                loop = asyncio.get_event_loop()
                response = await loop.run_in_executor(None, lambda: requests.get(attachment.url))
                buffer = response.content
                base64_data = base64.b64encode(buffer).decode('utf-8')
                media_data = {'mime_type': mime_type, 'base64': base64_data}

            ai_response = await generate_response(channel_id, thinking_prompt, media_data, None, True)
            response_chunks = split_text(ai_response)
            for chunk in response_chunks:
                await message.channel.send(chunk)
                await asyncio.sleep(1)
        return

    if content.lower().startswith('!gift'):
        async with message.channel.typing():
            gift_prompt = content.replace('!gift', '', 1).strip()
            ai_response = await generate_response(channel_id, gift_prompt)
            response_chunks = split_text(ai_response)
            for chunk in response_chunks:
                await message.channel.send(chunk)
                await asyncio.sleep(1)
        return

    if is_bot_active or content.startswith('!chat') or content.startswith('!cari'):
        prompt = content
        search_query = None

        if content.startswith('!cari'):
            search_query = content.replace('!cari', '', 1).strip()
            prompt = f"Berikan jawaban berdasarkan pencarian untuk: {search_query}"
        elif content.startswith('!chat'):
            prompt = content.replace('!chat', '', 1).strip()
        elif is_bot_active and not content.startswith('!'):
            prompt = content

        attachment = message.attachments[0] if message.attachments else None
        media_data = None

        if attachment:
            mime_type = attachment.content_type
            if mime_type not in SUPPORTED_MIME_TYPES:
                await message.reply('\nFormat file tidak didukung. Format yang didukung:\n- JPEG\n- PNG\n- GIF\n- PDF\n- MP4\n- MP3\n- WAV')
                return

            async with message.channel.typing():
                loop = asyncio.get_event_loop()
                response = await loop.run_in_executor(None, lambda: requests.get(attachment.url))
                buffer = response.content
                base64_data = base64.b64encode(buffer).decode('utf-8')
                media_data = {'mime_type': mime_type, 'base64': base64_data}

                ai_response = await generate_response(channel_id, prompt, media_data, search_query)
                response_chunks = split_text(ai_response)
                for chunk in response_chunks:
                    await message.channel.send(chunk)
                    await asyncio.sleep(1)
        else:
            async with message.channel.typing():
                ai_response = await generate_response(channel_id, prompt, None, search_query)
                response_chunks = split_text(ai_response)
                for chunk in response_chunks:
                    await message.channel.send(chunk)
                    await asyncio.sleep(1)

    await bot.process_commands(message)

bot.run(os.getenv('DISCORD_TOKEN'))