# Discord TTS Anime Bot

The Discord TTS Anime Bot is a Discord bot that integrates text-to-speech (TTS) features using GPT-SoVITS and Google Gemini. This bot can generate specific audio responses based on the selected character and conversation history.

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation and Setup](#installation-and-setup)
  - [1. Environment Setup](#1-environment-setup)
  - [2. Clone Repository & Install Dependencies](#2-clone-repository--install-dependencies)
  - [3. Download Required Models](#3-download-required-models)
  - [4. Configure API Keys and Environment Variables](#4-configure-api-keys-and-environment-variables)
  - [5. Create a Discord Bot](#5-create-a-discord-bot)
- [Running the Bot](#running-the-bot)
- [Usage](#usage)
- [Additional Information](#additional-information)

## Features

- **Character-Based TTS:** Switch between character voices such as "Mita" and "Otori Emu."
- **Chat History Integration:** Generates natural Japanese responses by referencing previous conversations.
- **Dual-Language Support:** Responds in both Japanese and English (text only).
- **Audio Generation:** Converts text responses into audio files and sends them to Discord (Japanese only).

## Prerequisites

- [Miniconda](https://docs.conda.io/en/latest/miniconda.html) or another Python environment manager.
- Python 3.9.18.
- CUDA Toolkit 12.6 (if using GPU acceleration).
- Git.

## Installation and Setup

### 1. Environment Setup

1. **Install Miniconda:**
   Download and install [Miniconda](https://docs.conda.io/en/latest/miniconda.html).

2. **Create and Activate Conda Environment:**

   ```bash
   cd /path/to/your/project
   conda create --prefix env python=3.9.18
   conda activate ./env
   ```

### 2. Clone Repository & Install Dependencies

1. **Clone GPT-SoVITS Repository:**

    ```bash
    git clone https://github.com/RVC-Boss/GPT-SoVITS
    cd GPT-SoVITS
    ```

2. **Install Required Dependencies:**

    ```bash
    pip install -r requirements.txt
    pip install discord asyncio google-generativeai deep-translator python-dotenv
    ```

3. **Create Required Directories:**

    ```bash
    mkdir -p GPT-SoVITS/pretrained_models
    mkdir -p tools/damo_asr/models
    mkdir -p tools/uvr5
    ```

### 3. Download Required Models

1. **Download GPT-SoVITS Model:**

    ```bash
    cd GPT-SoVITS/pretrained_models
    git clone https://huggingface.co/lj1995/GPT-SoVITS
    ```

2. **Download ASR and VAD Models:**

    ```bash
    cd ../../tools/damo_asr/models
    git clone https://www.modelscope.cn/damo/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch.git
    git clone https://www.modelscope.cn/damo/speech_fsmn_vad_zh-cn-16k-common-pytorch.git
    git clone https://www.modelscope.cn/damo/punc_ct-transformer_zh-cn-common-vocab272727-pytorch.git
    ```

3. **Download UVR5 Weights:**

    ```bash
    cd ../../uvr5
    git clone https://huggingface.co/Delik/uvr5_weights
    ```

4. **Download Discord Bot Script:**

    ```bash
    cd /path/to/your/GPT-SoVITS
    Invoke-WebRequest -Uri "https://raw.githubusercontent.com/NathanAbrahamSinaga/Discord_Bot/main/4TTSAnime/TTSAnime.py" -OutFile "TTSAnime.py"
    ```

5. **Folder Structure After Installation:**

    ```bash
    Project/
    ├── .env
    ├── GPT-SoVITS/
    │   └── TTSAnime.py
    └── Models/ [Download](https://drive.google.com/drive/folders/1HtUTs9jU9-YEkTzbxNLllDqc84a0NfR0?usp=sharing)
    ```

### 4. Configure API Keys and Environment Variables

1. **Create a `.env` file in the project root and add the following:**

    ```bash
    GEMINI_API_KEY="YOUR_GEMINI_API_KEY"
    DISCORD_BOT_TOKEN="YOUR_DISCORD_BOT_TOKEN"
    ```

2. **Get Google Gemini API Key:**

    - Visit [Google AI Studio](https://aistudio.google.com/) and log in.
    - Navigate to the API Keys section in the left sidebar.
    - Create a new API Key and add it to the `.env` file.

### 5. Create a Discord Bot

1. **Visit the Discord Developer Portal:**
   [Discord Developer Portal](https://discord.com/developers/applications)

2. **Create a New Application:**

    - Click **New Application** and name your bot.
    - In the **Bot** tab, click **Add Bot**.
    - Reset the token and copy it into `.env` under `DISCORD_BOT_TOKEN`.

3. **Set Bot Permissions:**

    - Go to **OAuth2 > URL Generator**.
    - Select **bot** and **applications.commands** as scopes.
    - Select the following permissions:
        - Read Message History
        - Send Messages
        - Send TTS Messages
        - Use Slash Commands
    - Copy the generated link and invite the bot to your Discord server.

## Running the Bot

Ensure all setup steps are completed, then run the bot using the following command:

```bash
python TTSAnime.py
```

## Usage

- **Switch Characters:**
  Use the **/mita** or **/otori_emu** command to switch between character voices.
- **Audio Commands:**
  Type `!audio <Japanese text>` to generate and send audio to Discord.
- **Mention the Bot:**
  Mention the bot in a message (e.g., `@BotName your message`) to trigger a response based on chat history.

## Additional Information

- **Dependencies:**
  The bot uses Python libraries such as `discord.py`, `torch`, `google-generativeai`, `deep_translator`, and others. Ensure all dependencies are installed in the Conda environment.
- **Model Configuration:**
  The bot supports multiple characters with individual model weights. Modify the model dictionary in `TTSAnime.py` if you want to add new characters.
- **Troubleshooting:**
  If you encounter model or API-related errors, check the console logs and ensure API keys and environment variables are correctly configured.

