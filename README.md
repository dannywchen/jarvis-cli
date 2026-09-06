# Jarvis CLI 🦉⚡

> **Duolingo-gamified learning meets the keyboard-driven polish of Claude Code.**

Jarvis CLI is a terminal-native learning game and study accelerator. Feed in any PDF, research paper, textbook chapter, or markdown note. Jarvis CLI parses the material, synthesizes core mental models, and builds a gamified skill tree with bite-sized lessons, interactive drills, combo multipliers, streaks, hearts, and spaced repetition.

The core loop is outcome-driven: tell Jarvis what you want to be able to do, and it turns that intent into a progressive roadmap. Your active course becomes the operating context for tutoring, quizzes, code questions, reviews, and next-step recommendations. Courses are durable and swappable, so you can keep several learning tracks without losing your place.

```
   ___    ___              ____          __
  / _ \__ / _ \___  ___    / ___/ __ ___  ___/ /__
 / // / // / // _ \/ _ \  / /__/ _ \/ _  / -_)
/____/\_,_/____/\___/\___/  \___/\___/\_,_/\__/

      ▲   ▲
     (o   o)    Jarvis the Cyber-Owl
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
- **Outcome-Driven Tutor Context**: Every generated course can store a target outcome, level, preferred mode, and resumable next lesson; free-form agent chat uses that context to stay focused on mastery.

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
cd /Users/dannywchen/Documents/GitHub/jarvis-cli
npm install
npm run build
```

### Launch Interactive Hub

```bash
node bin/jarvis.js
# or
npm start
```

---

## 📖 CLI Commands

```bash
# Ingest any PDF or document and generate a roadmap (default: standard pace)
node bin/jarvis.js load ./demo/quantum-computing.pdf

# Speedrun a document with accelerated pace
node bin/jarvis.js load ./demo/quantum-computing.pdf --pace accelerated

# Comprehensive deep-dive with boss challenges
node bin/jarvis.js load ./demo/quantum-computing.pdf --pace deep

# Resume learning your next active lesson
node bin/jarvis.js learn

# View visual skill tree and roadmap progress
node bin/jarvis.js roadmap

# Browse saved courses or switch focus (also works inside the REPL as /courses)
node bin/jarvis.js courses
node bin/jarvis.js courses 2

# Build an outcome-specific plan from a topic
node bin/jarvis.js topic "Rust concurrency" --goal "Build a safe concurrent service" --level intermediate

# Build an outcome-specific plan from a document
node bin/jarvis.js load ./notes.md --goal "Pass a systems design interview" --level advanced

# View profile stats, level progress bar, and badge showcase
node bin/jarvis.js stats

# Practice overdue spaced-repetition concepts & refill hearts
node bin/jarvis.js practice
```

---

## 🔑 Production-Level Authentication & Model Switching

Jarvis CLI connects directly to production LLM APIs with real-time credential validation:

```bash
/auth     # Open authentication manager & live key validator
/model    # Switch models dynamically across Google Gemini, OpenAI, and Anthropic
```

### Agent activity trace

Workspace-oriented prompts can now use a small local tool belt. When the active model needs context, the chat shows live, factual steps such as `Read src/index.ts`, `Searched for "queryActiveAgent"`, `Edited src/core/agentTools.ts`, or `Ran npm test`. These are execution events from actual operations, not simulated chain-of-thought; private reasoning is never rendered or persisted.

The tools are intentionally scoped to the current workspace. Reads and searches are available for code tasks, safe inspection commands plus `npm test` and `npm run build` can be run, and file writes only run when the user explicitly asks to change files. Ordinary tutoring prompts stay on the existing one-request path; only tasks that actually need workspace inspection may use additional model turns.

### Supported Production Models

| Provider | Models | Auth Method |
| :--- | :--- | :--- |
| **Google Gemini** | `gemini-3.8-flash`, `gemini-3.7-flash`, `gemini-3.5-flash`, `gemini-3.1-flash-lite` | Google Code Assist OAuth or `GEMINI_API_KEY` (aistudio.google.com/apikey) |
| **OpenAI / ChatGPT** | `gpt-5.6-luna` (default, high reasoning), `gpt-4o`, `gpt-4o-mini`, `o3-mini` | `OPENAI_API_KEY` (platform.openai.com/api-keys) or ChatGPT Codex CLI |
| **Anthropic Claude** | `claude-3-5-sonnet-20241022`, `claude-3-5-haiku-20241022`, `claude-3-opus` | `ANTHROPIC_API_KEY` (console.anthropic.com) |

When you enter a key, Jarvis CLI performs a live test ping against the provider's endpoint to ensure valid connectivity. New data lives at `~/.jarvis-cli`; existing `~/.duocode` profiles and courses are read as a non-destructive legacy fallback.

---

## 🤖 Agentic AI Integration & Skill

Jarvis CLI is built from the ground up for agentic collaboration with **Google Antigravity**, **Claude Code**, and **ChatGPT/Codex**.

### 1. Antigravity Skill Registered
Existing Antigravity installations may still reference the legacy skill path [`~/.gemini/config/skills/duocode/SKILL.md`](file:///Users/dannywchen/.gemini/config/skills/duocode/SKILL.md); the product and executable are now Jarvis CLI / `jarvis`.
Whenever you are chatting with Antigravity, you can say:
- *"Jarvis CLI: Teach me this PDF: `./paper.pdf`"*
- *"Quiz me on quantum gates and track my XP"*
- *"Check my Jarvis CLI streak and stats"*
- *"Start an interactive tutoring session on my active course"*

Antigravity autonomously drives the CLI, parses the material, quizzes you conversationally, and tracks your progress and streaks.

### 2. Conversational AI Tutor ("Jarvis the Cyber-Owl")
Run:
```bash
node bin/jarvis.js tutor
```
Launches an interactive, conversational voice/text study session with Jarvis the Cyber-Owl 🦉. Ask questions, request intuitive analogies, or get challenged with active recall questions directly in the terminal, earning curiosity XP as you study.

### 3. Machine-Readable Agent Commands (`jarvis agent ...`)
Agents can query and manipulate Jarvis CLI state programmatically via structured JSON:

```bash
# Output full user profile, active course, and due review cards
node bin/jarvis.js agent status

# Ingest a PDF and return the generated course hierarchy in JSON
node bin/jarvis.js agent ingest ./demo/quantum-computing.pdf --pace standard

# Fetch current lesson mental models, takeaways, and questions
node bin/jarvis.js agent lesson

# Submit a learner's answer and get AI evaluation, XP gains, and badge updates
node bin/jarvis.js agent submit -q <questionId> -a "<answer>"

# List or switch the active course for an external agent
node bin/jarvis.js agent courses
node bin/jarvis.js agent courses 2
```

Inside the interactive hub, use `/courses` to open the course switcher, `/courses <number-or-id>` to switch directly, `/roadmap` to see the active goal and progress, and `/learn` (or `/next`) to continue the loaded next lesson. You can also say “I want to learn Rust concurrency” or “build me a roadmap for system design” and Jarvis will create the course flow automatically. Natural-language questions remain available at any time; Jarvis interprets whether you want an explanation, comparison, application, quiz, review, debugging help, or a roadmap adjustment and keeps the answer connected to the active course when relevant.

---

## 🧠 AI Providers & Offline Mode

Jarvis CLI is built to be **100% functional offline out of the box** via its built-in procedural heuristic extractor:
- Ingests documents, extracts definitions, context sentences, and creates structured curriculums with zero API keys required.

Optionally, you can connect an LLM for dynamic curriculum generation:
- Set `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, or `OPENAI_API_KEY` in your environment, or configure it interactively inside the CLI with `/auth`.
- For browser-based Google OAuth, copy `.env.example` to `.env` and set `GEMINI_CLIENT_ID` and `GEMINI_CLIENT_SECRET` locally. `.env` is ignored by Git and is never included in pushes.

---

## 🧪 Testing

```bash
# Run automated test suite
npm test

# Run lesson simulation test
npx tsx test/lesson-simulation.test.ts
```
