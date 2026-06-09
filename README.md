# 🚀 LaunchForge

> **AI-powered launch plan generator for SaaS founders & indie hackers.**

Stop wasting time on generic advice. LaunchForge generates **tactical, personalized launch plans** custom-tailored to your product, audience, and niche.

---

## 📋 Table of Contents

- [Stack](#-stack)
- [Quick Start](#-quick-start)
- [API Endpoints](#-api-endpoints)
- [Architecture](#-architecture)
- [Examples](#-examples)
- [Environment Variables](#-environment-variables)
- [Testing](#-testing)
- [Next Steps](#-next-steps)

---

## 🛠 Stack

| Layer | Technology |
|-------|-----------|
| Runtime | **Node.js 18+** |
| Language | **TypeScript** (strict mode) |
| Framework | **Express 4** |
| Storage | In-memory (`Map`) |
| Testing | **Vitest + Supertest** |
| Dev server | **tsx watch** (hot reload) |

---

## ⚡ Quick Start

```bash
# Clone & install
git clone <your-repo-url> launchforge
cd launchforge
cp .env.example .env
npm install

# Development mode (hot reload)
npm run dev

# Build for production
npm run build

# Production mode
npm start
```

The server starts on **http://localhost:3000**.

---

## 📡 API Endpoints

### `GET /api/health`
Health check.

```bash
curl http://localhost:3000/api/health
```

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "timestamp": "2026-05-07T12:00:00.000Z"
  }
}
```

---

### `GET /api/templates`
List all available launch plan templates.

```bash
curl http://localhost:3000/api/templates
```

```json
{
  "success": true,
  "data": [
    {
      "id": "standard-launch",
      "name": "Standard Launch Plan",
      "description": "A comprehensive 4-week launch plan with community targeting, content strategy, and outreach.",
      "sections": ["weekly_plan", "community_targets", "content_angles", "outreach_strategy", "launch_sequencing", "validation_checklist", "first_users_tactics"]
    }
  ]
}
```

---

### `POST /api/plan`
Generate a personalized launch plan.

```bash
curl -X POST http://localhost:3000/api/plan \
  -H "Content-Type: application/json" \
  -d '{
    "productName": "TaskFlow",
    "description": "A project management tool for remote teams with AI-powered task assignments",
    "targetAudience": "Remote software teams of 5-50 people",
    "niche": "saas",
    "goals": ["first 100 users", "product hunt launch", "10 paying customers"],
    "pricing": "$29/month per team"
  }'
```

**Response** (truncated for readability):
```json
{
  "success": true,
  "data": {
    "id": "a1b2c3d4-...",
    "createdAt": "2026-05-07T12:00:00.000Z",
    "input": { ... },
    "weekly_plan": [
      {
        "week": 1,
        "theme": "Pre-launch & Validation",
        "actions": ["Set up a landing page for TaskFlow with email capture", ...],
        "kpis": ["50 waitlist signups", "5 customer interviews completed", "10 social media posts"]
      }
    ],
    "community_targets": [...],
    "content_angles": [...],
    "outreach_strategy": [...],
    "launch_sequencing": [...],
    "validation_checklist": [...],
    "first_users_tactics": [...]
  }
}
```

---

### `GET /api/plan/:id`
Retrieve a previously generated plan by ID.

```bash
curl http://localhost:3000/api/plan/a1b2c3d4-...
```

```json
{
  "success": true,
  "data": { ... }
}
```

---

### `POST /api/feedback`
Submit feedback on a generated plan.

```bash
curl -X POST http://localhost:3000/api/feedback \
  -H "Content-Type: application/json" \
  -d '{
    "planId": "a1b2c3d4-...",
    "rating": 5,
    "comment": "The community outreach section was incredibly useful!"
  }'
```

```json
{
  "success": true,
  "data": {
    "id": "f1e2d3c4-...",
    "planId": "a1b2c3d4-...",
    "rating": 5,
    "comment": "The community outreach section was incredibly useful!",
    "createdAt": "2026-05-07T12:00:00.000Z"
  }
}
```

---

## 🏗 Architecture

```
src/
├── index.ts              # Entry point — starts Express server
├── app.ts                # Express app configuration, middleware, routes
├── types/
│   └── index.ts          # TypeScript interfaces & types
├── templates/
│   └── index.ts          # Plan template engine — generates all sections
├── services/
│   ├── storage.ts        # In-memory storage (Map-based)
│   └── planGenerator.ts  # Orchestrates plan creation
├── middleware/
│   ├── rateLimit.ts      # Simple IP-based rate limiter
│   └── validation.ts     # Input validation for plan & feedback
├── routes/
│   ├── plan.ts           # POST /api/plan, GET /api/plan/:id
│   ├── templates.ts      # GET /api/templates
│   └── feedback.ts       # POST /api/feedback
tests/
└── plan.test.ts          # Integration tests (Vitest + Supertest)
```

### Data Flow

```
Client → Express → rateLimit → validation → route handler → planGenerator
                                                              ↓
                                                         templates module
                                                              ↓
                                                         storage (Map)
                                                              ↓
                                                    JSON response ← Client
```

---

## 🌍 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `NODE_ENV` | `development` | Environment mode |
| `DB_PATH` | `./data/launchforge.db` | SQLite database file |
| `JWT_SECRET` | dev fallback | Secret for auth tokens — set in production |
| `ANTHROPIC_API_KEY` | — | Claude API key. Powers the AI onboarding assistant (`/api/onboarding`) and AI plan generation. Without it, onboarding falls back to a manual form and plans use static templates. |

Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

---

## 🧪 Testing

```bash
# Run tests (single run)
npm test

# Watch mode
npm run test:watch
```

Tests cover:
- Health check endpoint
- Template listing
- Plan creation with valid/invalid input
- Plan retrieval by ID
- Feedback submission with validation
- Error handling (404, 400, 429)

---

## 🚀 Next Steps

- [ ] **Persistent storage** — PostgreSQL via Prisma or SQLite
- [ ] **OpenAI integration** — Replace template engine with GPT-4o generation for hyper-personalized plans
- [ ] **Authentication** — Clerk or NextAuth for user accounts
- [ ] **Frontend** — Next.js dashboard with plan history, sharing, export (PDF)
- [ ] **Plan scoring** — Score plans by estimated impact
- [ ] **Webhooks** — Notify users when their plan is ready
- [ ] **Freemium tier** — Basic plan free, premium with AI generation
- [ ] **Analytics** — Track which sections users engage with most
- [ ] **Export** — PDF, Markdown, Notion, or Linear integration

---

## 📄 License

MIT
# test push agent
# test push agent
# test push agent
# test push agent
retest
retest
