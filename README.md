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


# 🗄️ Database & Accounts (Supabase)

The site is static (GitHub Pages), so **all permissions live in the database** as Row Level Security.
The anon key in the frontend is public by design; never put the `service_role` key in the repo or the site.

| Page | Who | What |
|---|---|---|
| `index.html` | everyone | 3D landing page + public club info |
| `login.html` | everyone | Google or email sign-in · create account · reset password; forwards to the right area |
| `ratings.html` | everyone | how the club rating works, with a calculator |
| `player.html` | players | first-visit level survey, club + Lichess rating & graph, register/withdraw, my games, profile |
| `admin.html` | admins | players (all details, levels), accounts (roles, delete), tournaments, entries, rounds, games + PGN import, teams, matches, committee, announcements, milestones, roles |

Schema: [`supabase/migrations/`](supabase/migrations/). Tables: `profiles`, `players`, `player_private`, `committee_members`, `teams`, `team_members`, `tournaments`, `tournament_entries`, `rounds`, `matches`, `games`, `rating_history`, `announcements`, `milestones`. Views: `tournament_standings` (with Buchholz), `team_standings`, `player_stats`.

Rules in short:
* Anyone can sign up (Google or email) and is an **active** player straight away. Admins can edit every detail and delete accounts.
* On first visit a player picks a level that sets their **starting rating**: beginner 800 · intermediate 1400 · professional 1600. They can change it until their first rated game; after that only admins can.
* **Club rating** is Elo (K 40 for the first 30 games, then 20) over rated **offline** (`source = otb/other`) games only, replayed from the start whenever a game or a starting rating changes. Explained on `ratings.html`.
* **Online (Lichess) games** don't touch the club rating; their `WhiteElo`/`BlackElo` (+ `RatingDiff`) from the PGN are stored on the game and the latest becomes the player's Lichess rating.
* Players can edit their own profile and private details, register or withdraw themselves while registration is open, and nothing else.
* Admin rights can only be granted by an existing admin or from the SQL editor.

### One-time setup
1. **Apply the schema.** Either paste `supabase/migrations/*.sql` into the Supabase SQL editor and run it, or:
   ```bash
   supabase login
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```
2. **Auth URLs** (Dashboard → Authentication → URL Configuration): Site URL `https://devnori-lab.github.io/ChessClub/`, and add redirect URLs `https://devnori-lab.github.io/ChessClub/**` and `http://localhost:5173/ChessClub/**`.
3. **Google sign-in.**
   1. [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → OAuth consent screen: set it up (External, app name, support email).
   2. Credentials → Create credentials → OAuth client ID → *Web application*. Authorised JavaScript origin `https://devnori-lab.github.io`; authorised redirect URI: the **Callback URL** shown in Supabase → Authentication → Sign In / Providers → Google (`https://<ref>.supabase.co/auth/v1/callback`).
   3. Paste the Client ID and Client secret into that Supabase Google provider page and enable it.
4. **Keys.** Copy `.env.example` to `.env` with the Project URL and the anon/publishable key (Dashboard → Project Settings → API). Add the same two values as GitHub repo secrets `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (Settings → Secrets and variables → Actions) so the deploy build gets them.
5. **First admin.** Sign up on the site, then in the SQL editor:
   ```sql
   update public.profiles set role = 'admin'
    where id = (select id from auth.users where email = 'you@example.com');
   ```
   After that, promote others from Admin → Accounts & roles.

> Supabase's built-in email sender is heavily rate-limited on the free tier (a few emails per hour). For real sign-ups, add custom SMTP under Authentication → Emails, or turn off "Confirm email" while testing.

---

**Maintained** by the GBPUAT Chess Club Technical Wing.
-Aditya Upreti