import discord
import numpy as np
import asyncio

class GridWorldEnv:
    def __init__(self, grid):
        self.grid = grid
        self.n_rows = len(grid)
        self.n_cols = len(grid[0])
        self.start = None
        self.goal = None
        for i in range(self.n_rows):
            for j in range(self.n_cols):
                if grid[i][j] == "S":
                    self.start = (i, j)
                elif grid[i][j] == "G":
                    self.goal = (i, j)
        self.agent_pos = self.start

    def reset(self):
        self.agent_pos = self.start
        return self.agent_pos

    def step(self, action):
        row, col = self.agent_pos
        if action == 0:
            new_row, new_col = row - 1, col
        elif action == 1:
            new_row, new_col = row + 1, col
        elif action == 2:
            new_row, new_col = row, col - 1
        elif action == 3:
            new_row, new_col = row, col + 1
        else:
            new_row, new_col = row, col

        if new_row < 0 or new_row >= self.n_rows or new_col < 0 or new_col >= self.n_cols:
            new_row, new_col = row, col
        elif self.grid[new_row][new_col] == "1":
            new_row, new_col = row, col

        self.agent_pos = (new_row, new_col)
        reward = -1
        done = False
        if self.agent_pos == self.goal:
            reward = 100
            done = True
        return self.agent_pos, reward, done

class QLearningAgent:
    def __init__(self, n_rows, n_cols, n_actions=4, alpha=0.1, gamma=0.9,
                 epsilon=1.0, epsilon_min=0.1, epsilon_decay=0.995):
        self.n_rows = n_rows
        self.n_cols = n_cols
        self.n_actions = n_actions
        self.alpha = alpha
        self.gamma = gamma
        self.epsilon = epsilon
        self.epsilon_min = epsilon_min
        self.epsilon_decay = epsilon_decay
        self.q_table = np.zeros((n_rows, n_cols, n_actions))

    def choose_action(self, state):
        row, col = state
        if np.random.rand() < self.epsilon:
            return np.random.choice(self.n_actions)
        else:
            return np.argmax(self.q_table[row, col])

    def learn(self, state, action, reward, next_state):
        row, col = state
        next_row, next_col = next_state
        predict = self.q_table[row, col, action]
        target = reward + self.gamma * np.max(self.q_table[next_row, next_col])
        self.q_table[row, col, action] += self.alpha * (target - predict)

    def decay_epsilon(self):
        if self.epsilon > self.epsilon_min:
            self.epsilon *= self.epsilon_decay
            if self.epsilon < self.epsilon_min:
                self.epsilon = self.epsilon_min

def train_agent(env, episodes=2000, max_steps=200):
    agent = QLearningAgent(env.n_rows, env.n_cols)
    for ep in range(episodes):
        state = env.reset()
        for step in range(max_steps):
            action = agent.choose_action(state)
            next_state, reward, done = env.step(action)
            agent.learn(state, action, reward, next_state)
            state = next_state
            if done:
                break
        agent.decay_epsilon()
    return agent

def render_grid_with_agent(grid, agent_pos):
    rendered = []
    for i, row in enumerate(grid):
        row_str = ""
        for j, cell in enumerate(row):
            if (i, j) == agent_pos:
                row_str += "A "
            else:
                row_str += cell + " "
        rendered.append(row_str)
    return "\n".join(rendered)

intents = discord.Intents.default()
intents.message_content = True
client = discord.Client(intents=intents)

@client.event
async def on_ready():
    print(f"Logged in sebagai {client.user}")

@client.event
async def on_message(message):
    if message.author == client.user:
        return

    if message.content.startswith("!gridworld"):
        lines = message.content.split("\n")[1:]
        if not lines:
            await message.channel.send(
                "Buat dunia grid....\nContoh:\n```\nS 0 0 1\n0 1 0 0\n0 0 0 G\n```"
            )
            return

        grid = [line.strip().split() for line in lines if line.strip()]
        if not any("S" in row for row in grid) or not any("G" in row for row in grid):
            await message.channel.send("Grid harus mengandung 'S' sebagai titik awal dan 'G' sebagai tujuan.")
            return

        env = GridWorldEnv(grid)
        await message.channel.send("Melatih agen RL... SING SABAR!")
        agent = train_agent(env, episodes=1000)
        await message.channel.send("Latihan selesai! Mulai simulasi...")

        state = env.reset()
        step_count = 0
        max_simulation_steps = 100

        simulation_message = await message.channel.send("Mulai simulasi...")

        while step_count < max_simulation_steps:
            grid_render = render_grid_with_agent(grid, state)
            content = f"Langkah {step_count}:\n```\n{grid_render}\n```"
            await simulation_message.edit(content=content)

            if state == env.goal:
                await message.channel.send("Goal tercapai! 🎉")
                break

            action = np.argmax(agent.q_table[state[0], state[1]])
            next_state, reward, done = env.step(action)
            state = next_state
            step_count += 1

            await asyncio.sleep(1)
        else:
            await message.channel.send("Maaf kami goblog")

TOKEN = "yourdiscordtoken"

if not TOKEN or TOKEN == "YOUR_BOT_TOKEN":
    print("Error: Discord Token tidak ada atau belum diatur.")
else:
    client.run(TOKEN)
