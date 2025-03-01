# Discord TTS Anime Bot

This project is a Discord bot that integrates text-to-speech (TTS) functionalities using GPT-SoVITS and Google Gemini. The bot generates character-specific audio responses based on chat history and user input.

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Setup and Installation](#setup-and-installation)
  - [1. Environment Setup](#1-environment-setup)
  - [2. Clone Repository & Install Dependencies](#2-clone-repository--install-dependencies)
  - [3. Download Required Models](#3-download-required-models)
  - [4. Configure API Keys and Environment Variables](#4-configure-api-keys-and-environment-variables)
  - [5. Create Your Discord Bot](#5-create-your-discord-bot)
- [Running the Bot](#running-the-bot)
- [Usage](#usage)
- [Additional Information](#additional-information)

## Features

- **Character-specific TTS:** Switch between characters (e.g., "Mita" and "Otori Emu") with distinct voices.
- **Chat History Integration:** Generates natural Japanese responses by referencing the recent conversation history.
- **Dual-Language Support:** Outputs responses in Japanese and English.
- **Audio Generation:** Converts generated text responses into audio files and sends them on Discord.

## Prerequisites

- [Miniconda](https://docs.conda.io/en/latest/miniconda.html) or any Python environment manager.
- Python 3.9.18.
- CUDA Toolkit 12.6 (for GPU acceleration, if required).
- Git

## Setup and Installation

### 1. Environment Setup

1. **Install Miniconda:**  
   Download and install [Miniconda](https://docs.conda.io/en/latest/miniconda.html).

2. **Create a Conda Environment:**

   ```bash
   cd /path/to/your/project
   conda create --prefix env python=3.9.18
   conda activate ./env

