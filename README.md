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


* **URL:** https://devnori-lab.github.io/ChessClub/