# AI-Watcher 👁️

**AI-Watcher** is a lightweight, zero-configuration developer tool that watches your local codebase and generates an interactive, live-updating visual dashboard of your application's architecture.

It helps developers and AI coding agents understand code relationships, database schemas, and architectural boundaries in real-time.

---

## 🎨 Features

- **🌐 Functions Call-Graph:** Visualizes call hierarchies between functions and methods. Highlights hover effects and detects broken reference chains instantly.
- **🗄️ Database ERD:** Auto-extracts ORM models (Prisma, SQL schemas, and generic code models) and visualizes foreign-key relations with PK/FK indicators.
- **🏗️ Architecture View:** Maps your files into logical layers (CLI, Application, Server, Database, etc.) using D3 tree structures with rich details:
  - **Entity Breakdown:** Count of functions (`fns`) and database tables (`dbs`) in each file.
  - **Code Metrics:** File-level incoming and outgoing call dependencies.
  - **Activity Heatmap:** Number of recent edits parsed from live history.

---

## 🚀 Installation

Install the package globally via npm:

```bash
npm install -g @vmcreate/ai-watcher
```

Alternatively, run it without installation using `npx`:

```bash
npx @vmcreate/ai-watcher
```

---

## 💻 Usage

Navigate to your project directory and start the watcher:

```bash
cd /path/to/your/project
ai-watcher
```

To watch a specific directory from elsewhere, pass the path as an argument:

```bash
ai-watcher ./my-project
```

Once started, AI-Watcher will:
1. Scan your project files for functions and database models.
2. Spin up a local server at **`http://localhost:4321`**.
3. Open your default web browser automatically to show the interactive dashboard.
4. Listen for live file changes to update the graphs instantly without reloading.

---

## ⚙️ Configuration & Supported Languages

AI-Watcher is language-agnostic and supports parsing:
- **Languages:** JavaScript, TypeScript, Dart, Python, Go, Rust, Java, C#, C++, Swift, Kotlin, and more.
- **DB Schemas:** Prisma schema (`.prisma`), SQL scripts (`.sql`), and **TypeScript/Angular model interfaces** (`.model.ts`).

It automatically generates a `.ai_context.json` file in your project root containing structured data for AI agents to easily read the codebase state.

---

## 📝 Changelog

### v3.0.3
- **Angular & TypeScript Model Support**: Auto-extracts database models from TypeScript interfaces (`export interface`) and handles optional properties (`?:`) and path-based model file heuristics.
- **Responsive Masonry Grid Layout (DB Tab)**: Arranges database tables in a neat column-based masonry grid layout that dynamically recalculates on window resize, resolving card overlapping.
- **Tab Switch Transition Fix**: Wakes up D3 physics immediately when switching between DB Visualisation and Functions Graph tabs.
- **Improved Drag-Release Snapping**: Instantly snaps dragged database cards back into their correct column grid position upon drag release.
- **Clean English UI**: Fully localized the entire dashboard interface to English.

---

## 🤖 AI Agent Integration (System Prompt & Rules)

AI-Watcher is designed to work in synergy with AI coding assistants (like Gemini, Claude, Cursor Agent, or Copilot). 

To ensure the AI agent remains aligned with your codebase, copy the following instructions into your agent's system prompt or global project rules (e.g., `AGENTS.md` or `.cursorrules`):

```markdown
### AI-Watcher Alignment Instructions

1. **Read `.ai_context.json` First:** Before performing any code modifications, research, or analysis, you MUST read the `.ai_context.json` file in the project root to get the latest functions graph, DB tables, and dependencies.
2. **Context Digest (10000-line Rule):** If the accumulated changes in the project during this session exceed 10000 lines of code, AI-Watcher will print a warning in the terminal. When you see this warning, you must pause, read `.ai_context.json` again, and write/digest the current architecture status into your persistent context (your AI brain) to avoid context drift.
3. **Sync Architecture to Memory:** Whenever you introduce new classes, DB models, or architectural layers, ensure you update your internal memory context with the new design decisions.
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
