# OBAMA Ride Platform - Monorepo Documentation

Welcome to the **Ojek Batu-Malang Raya (OBAMA)** monorepo. This directory houses all client applications, backend servers, shared packages, deployment configurations, and specifications.

## Repository Layout

```text
OBAMA/
├── apps/                          # Application Clients & Services
│   ├── customer-mobile/          # Android Customer App (Symlinked to root Android app for build compatibility)
│   ├── driver-mobile/            # Android Driver App (Symlinked to root Android app for build compatibility)
│   ├── admin-web/                # React Vite Admin Portal & Desktop Client
│   └── backend/                  # Node.js, Express, Prisma, & Redis Core API
├── packages/                      # Shared Library Packages
│   ├── shared-types/             # Common TypeScript interfaces and models
│   ├── shared-api/               # Axios client wrappers and central endpoint map
│   ├── shared-ui/                # Design specs, Material 3 tokens, layout helpers
│   └── shared-utils/             # Currency, distance (Haversine), and date helpers
├── docs/                          # Platform architecture and technical design docs
├── docker/                        # Multi-service docker orchestration configurations
└── app/                           # Active Android Kotlin/Compose main build directory
```

## Architectural Breakdown

### 1. Applications (`apps/`)

*   **`apps/customer-mobile/`**: Built on Kotlin Jetpack Compose, supporting customer ride search, wallet topups, and dynamic fare estimation. It shares state via a local Room Database.
*   **`apps/driver-mobile/`**: Provides full job matching, GPS routing simulated on Malaga-Batu, and real-time statuses.
*   **`apps/admin-web/`**: Powered by Vite and React, enabling driver verification, auditing, system performance monitoring, and secure system activity logs.
*   **`apps/backend/`**: Serves as the single API entrypoint for database CRUD (Prisma/PostgreSQL), secure user authentications (JWT), and async operations using BullMQ and Redis.

### 2. Shared Packages (`packages/`)

*   **`@obama/shared-types`**: Pure typescript types mirroring database records to maintain type parity across client and server.
*   **`@obama/shared-api`**: Resolves dynamic development port proxying in AI Studio.
*   **`@obama/shared-ui`**: Unifies branding, layout boundaries, and visual assets (Teal/Amber and Slate theme).
*   **`@obama/shared-utils`**: Encapsulates essential geospatial functions (Haversine) for Malang Raya and Rupiah currency formatting.

---

## Local Development Quickstart

### Prerequisites
*   Node.js v20+
*   Docker & Docker Compose
*   Android SDK / Studio

### Step 1: Spin up Databases & Caching
Run Docker Compose from either the root or the dedicated `docker/` folder:
```bash
docker compose -f docker/docker-compose.yml up -d
```

### Step 2: Set up and Run Backend
```bash
cd apps/backend
npm install
npx prisma db push
npm run dev
```

### Step 3: Run Admin Web Client
```bash
cd apps/admin-web
npm install
npm run dev
```

### Step 4: Run Android Emulator or compile APK
Using standard Gradle commands in the workspace root:
```bash
gradle compileDebugKotlin
```
_Note: The Android source is managed in `/app` and accessible via symlinks at `apps/customer-mobile` and `apps/driver-mobile`._
