# ♟️ 3D Chess Club Platform

A high-performance, chessclub web application built from the ground up using **Vanilla JavaScript**, **Three.js**, **Vite**, and **Supabase**. 

---

## ⚡ Tech Stack

* **Game Logic & State:** Vanilla JavaScript (Headless 8x8 board state machine, move validation, and turn management)
* **3D Rendering Layer:** [Three.js](https://threejs.org/) (WebGL canvas presentation, GLTF piece loading, PBR materials, lighting, and visual animations)
*   **Backend & Database:** [Supabase](https://supabase.com/) (PostgreSQL database, real-time subscriptions, player authentication)
*   **Build Tool & Bundler:** [Vite](https://vitejs.dev/) (Instant HMR, lightning-fast production builds, native `.env` handling)
*   **Language:** Vanilla JavaScript (ES6+ Modules)
*   **Styling:** Native CSS3 (Fullscreen canvas styling, responsive viewport management)

---

## 📂 Architecture & Directory Layout

To keep the 3D rendering pipeline and database logic clean and maintainable, the codebase separates scene bootstrapping, board mechanics, and backend connections into dedicated modules:

```text
├── public/
│   ├── models/          # Static 3D assets (.glb / .gltf piece models)
│   └── textures/        # PBR materials (wood, marble, normal maps for squares)
├── src/
│   ├── assets/          # Image assets
│   ├── board.js         # Chessboard grid generation, tile math, and piece placement
│   ├── scene.js         # Camera perspective, lighting rigs, and renderer configuration
│   ├── style.css        # Fullscreen canvas and viewport styling
│   ├── supabase.js      # Supabase client declaration and initialization
│   └── main.js          # Animation loop (requestAnimationFrame), controls, and raycasting
├── .gitignore           # Automatically ignores node_modules and .env secrets
├── index.html           # Single-page entry point
├── package.json
└── vite.config.js       # Bundler and static asset configuration
```

* **URL:** https://devnori-lab.github.io/ChessClub/



-------------------------------------------------
--- --- --- --- --- --- --- --- --- --- --- --- -
-------------------------------------------------




# GBPUAT Chess Club // Official Web Portal

> **FOSTERING STRATEGIC EXCELLENCE**
> Welcome to the official digital portal of the GBPUAT Chess Club. Dedicated to cultivating analytical thinking, foresight, and mastery of the board within the university community.

---

## ⚙️ Tech Stack

* **Build Tool:** [Vite](https://vitejs.dev/)
* **Core:** Vanilla JavaScript, HTML5, CSS3
* **3D Engine:** [Three.js](https://threejs.org/) (Custom WebGL STL Rendering)
* **Animation:** GSAP & SplitType
* **Architecture:** Custom Single Page Application (SPA) Router

---

## 🏛️ Platform Architecture (Module-Based SPA)

To maintain uninterrupted WebGL rendering on the landing canvas, the platform utilizes a flattened DOM structure. Core features are divided into four primary modules injected seamlessly via a custom Vanilla JS router, avoiding traditional page reloads.

### 01. Events & Competitions
*Replaces standard nested forms and static calendars.*
* **Active Circuit:** Unified dashboard highlighting current active tournaments and upcoming timelines.
* **Registration Portal:** Smooth side-panel overlays for tournament guidelines and official registration.

### 02. Leaderboard & Analytics
*Focuses on precise data visualization and player metrics.*
* **Global Rankings:** Real-time ELO tracking for all verified club members.
* **Performance Metrics:** Individual player profiles showcasing win/loss ratios, frequent matchups, and statistical data on preferred opening strategies (e.g., *Sicilian Defense: 60% Success Rate*).

### 03. Match Archives
*Dedicated space for strategic review and skill development.*
* **Featured Match Analysis:** Structured grid of notable past university matches.
* **Tactical Playback:** Integrated PGN (Portable Game Notation) viewer allowing students to step through historical games move-by-move.

### 04. Honors & Connectivity
*Centralized hub for university prestige and official communications.*
* **Club Honors:** Visual timeline showcasing inter-college victories, university trophies, and notable alumni.
* **Official Communications:** Authenticated gateways to join official WhatsApp groups and community channels.

---

## 🚀 Development Setup

This project is engineered for maximum performance without heavy framework overhead. Use your terminal to initialize the environment:

```bash
# Clone the repository
git clone <repository-url>

# Navigate into the project directory
cd gbpuat-chess-club

# Install dependencies (Three.js, GSAP, etc.)
npm install

# Start the Vite development server
npm run dev
```

---


# 🔧 System Notes for Backend Integration
The frontend UI is strictly decoupled from the data layer. The Vanilla JS SPA router is designed to eventually hook into standard REST endpoints for dynamic data ingestion, keeping the architecture clean:

* GET /api/tournaments/active -> Populates Events & Competitions

* GET /api/players/metrics -> Populates Leaderboard & Analytics

* GET /api/matches/pgn/:id -> Feeds the Match Archives viewer

---

**Maintained** by the GBPUAT Chess Club Technical Wing.
-Aditya Upreti