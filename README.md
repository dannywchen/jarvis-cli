# DuoCode 🦉⚡

> **Duolingo-gamified learning meets the keyboard-driven polish of Claude Code.**

DuoCode is a terminal-native learning game and study accelerator. Feed in any PDF, research paper, textbook chapter, or markdown note. DuoCode parses the material, synthesizes core mental models, and builds a gamified skill tree with bite-sized lessons, interactive drills, combo multipliers, streaks, hearts, and spaced repetition.

```
   ___    ___              ____          __
  / _ \__ / _ \___  ___    / ___/ __ ___  ___/ /__
 / // / // / // _ \/ _ \  / /__/ _ \/ _  / -_)
/____/\_,_/____/\___/\___/  \___/\___/\_,_/\__/

      ▲   ▲
     (o   o)    Byte the Cyber-Owl
      > ( v ) <    Gamified Terminal Learning Accelerator
       /" "\

 🔥 1 Day  │  ⚡ 70 XP (Lvl 2)  │  💖💖💖💖💖  │  🎯 Quantum Computing [■■□□□□□□] 20%
```

---

## 🌟 Key Features

### 1. Claude Code Look & Feel
- **Terminal Status Ribbon**: Real-time stats bar tracking your active streak (🔥), XP & level (⚡), energy hearts (💖), and roadmap completion progress (🎯).
- **Interactive REPL Hub**: Arrow-key navigation, instant validation, clean markdown cards, and fluid CLI animations.
- **Thinking Spinners**: Visual progress indicators for document parsing, semantic analysis, and curriculum synthesis.
- **Design Guidelines Compliant**: Dark/muted terminal borders and cards with high contrast readability and zero distracting white outlines.

### 2. Duolingo Gamification Engine
- **3 Adaptive Paces**:
  - 🚀 **Accelerated (Speedrun)**: 3–4 high-yield nodes; rapid mental models and quickfire quizzes.
  - ⚖️ **Standard (Balanced)**: 5–8 nodes; sequential unit progression and checkpoint evaluations.
  - 🔬 **Deep-Dive (Mastery)**: 8–14 nodes; granular theory, edge cases, and boss gauntlets.
- **Visual Skill Tree (Roadmap)**:
  - `👑` Mastered Nodes (multiple crowns)
  - `●` Completed Nodes
  - `◎` Active Node (`START HERE ▶`)
  - `○` Locked Nodes
  - `⚔️` Checkpoint / Boss Challenges
- **Bite-Sized Lessons**:
  - **Mental Model Digest**: Ultra-concise briefing with key takeaways and intuitive real-world analogies.
  - **Multiple-Choice Questions**: Dynamic options with detailed explanations for right and wrong answers.
  - **Fill-in-the-Blank (Cloze)**: Active recall keyword prompts.
  - **Concept Pairing**: Match technical terms with definitions.
  - **Scenario Challenges**: Architectural reasoning and debugging questions.
- **XP, Combos & Celebrations**:
  - +15 to +30 XP per question with consecutive combo multipliers (`x2`, `x3! ON FIRE`, `x4! UNSTOPPABLE`).
  - Terminal confetti animation and chimes upon lesson completion.
  - Level-up fanfare and level progress bars.
  - 8 unlockable badges (e.g. *First Byte*, *On Fire*, *Centurion*, *Flawless Victory*, *Boss Slayer*).
- **Hearts & Zen Mode**:
  - Standard 5-heart shield system with heart loss on mistakes.
  - Practice mode with quick drills to refill shields.
  - Toggleable **Zen Mode** for zero-penalty study sessions.
- **Spaced Repetition (SM-2)**:
  - Mistakes automatically feed into an SM-2 Leitner spaced repetition review queue to solidify long-term retention.

---

## 🚀 Quick Start

### Installation & Setup

```bash
cd /Users/dannywchen/Documents/GitHub/duocode
npm install
npm run build
```

### Launch Interactive Hub

```bash
node bin/duocode.js
# or
npm start
```

---

## 📖 CLI Commands

```bash
# Ingest any PDF or document and generate a roadmap (default: standard pace)
node bin/duocode.js load ./demo/quantum-computing.pdf

# Speedrun a document with accelerated pace
node bin/duocode.js load ./demo/quantum-computing.pdf --pace accelerated

# Comprehensive deep-dive with boss challenges
node bin/duocode.js load ./demo/quantum-computing.pdf --pace deep

# Resume learning your next active lesson
node bin/duocode.js learn

# View visual skill tree and roadmap progress
node bin/duocode.js roadmap

# View profile stats, level progress bar, and badge showcase
node bin/duocode.js stats

# Practice overdue spaced-repetition concepts & refill hearts
node bin/duocode.js practice
```

---

## 🔑 Production-Level Authentication & Model Switching

DuoCode connects directly to production LLM APIs with real-time credential validation:

```bash
/auth     # Open authentication manager & live key validator
/model    # Switch models dynamically across Google Gemini, OpenAI, and Anthropic
```

### Supported Production Models

| Provider | Models | Auth Method |
| :--- | :--- | :--- |
| **Google Gemini** | `gemini-2.0-flash`, `gemini-1.5-pro`, `gemini-1.5-flash` | `GEMINI_API_KEY` (aistudio.google.com/app/apikey) |
| **OpenAI / ChatGPT** | `gpt-4o`, `gpt-4o-mini`, `o3-mini` | `OPENAI_API_KEY` (platform.openai.com/api-keys) |
| **Anthropic Claude** | `claude-3-5-sonnet-20241022`, `claude-3-5-haiku-20241022`, `claude-3-opus` | `ANTHROPIC_API_KEY` (console.anthropic.com) |

When you enter a key, DuoCode performs a live test ping against the provider's endpoint to ensure valid connectivity, saving verified credentials in `~/.duocode/profile.json`.

---

## 🤖 Agentic AI Integration & Skill

DuoCode is built from the ground up for agentic collaboration with **Google Antigravity**, **Claude Code**, and **ChatGPT/Codex**.

### 1. Antigravity Skill Registered
DuoCode is installed as a global skill at [`~/.gemini/config/skills/duocode/SKILL.md`](file:///Users/dannywchen/.gemini/config/skills/duocode/SKILL.md).
Whenever you are chatting with Antigravity, you can say:
- *"DuoCode: Teach me this PDF: `./paper.pdf`"*
- *"Quiz me on quantum gates and track my XP"*
- *"Check my DuoCode streak and stats"*
- *"Start an interactive tutoring session on my active course"*

Antigravity autonomously drives the CLI, parses the material, quizzes you conversationally, and tracks your progress and streaks.

### 2. Conversational AI Tutor ("Byte the Cyber-Owl")
Run:
```bash
node bin/duocode.js tutor
```
Launches an interactive, conversational voice/text study session with Byte the Cyber-Owl 🦉. Ask questions, request intuitive analogies, or get challenged with active recall questions directly in the terminal, earning curiosity XP as you study.

### 3. Machine-Readable Agent Commands (`duocode agent ...`)
Agents can query and manipulate DuoCode state programmatically via structured JSON:

```bash
# Output full user profile, active course, and due review cards
node bin/duocode.js agent status

# Ingest a PDF and return the generated course hierarchy in JSON
node bin/duocode.js agent ingest ./demo/quantum-computing.pdf --pace standard

# Fetch current lesson mental models, takeaways, and questions
node bin/duocode.js agent lesson

# Submit a learner's answer and get AI evaluation, XP gains, and badge updates
node bin/duocode.js agent submit -q <questionId> -a "<answer>"
```

---

## 🧠 AI Providers & Offline Mode

DuoCode is built to be **100% functional offline out of the box** via its built-in procedural heuristic extractor:
- Ingests documents, extracts definitions, context sentences, and creates structured curriculums with zero API keys required.

Optionally, you can connect an LLM for dynamic curriculum generation:
- Set `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, or `OPENAI_API_KEY` in your environment, or configure it interactively inside the CLI (`duocode > Settings > Configure AI Provider`).

---

## 🧪 Testing

```bash
# Run automated test suite
npx tsx test/duocode.test.ts

# Run lesson simulation test
npx tsx test/lesson-simulation.test.ts
```
