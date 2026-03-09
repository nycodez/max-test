# Max - AI CRM Operator

Max is a voice-enabled CRM operator with a focused MVP: users can talk or type to create and review contacts, companies, and follow-up tasks from one runtime UI.

## Current MVP

Max currently focuses on one concrete workflow:

- **Create CRM records**: add contacts, companies, and follow-up tasks from chat or voice
- **Review recent work**: list recent records and open tasks in the operator workspace
- **Keep thread history**: store assistant conversations per tenant/user
- **Support hands-free operation**: keep the existing voice transcription and TTS loop for operators who want it

## Key Features

### Assistant + Operator UI
- **Voice Interaction**: speech-to-text plus Google Cloud TTS with native fallback
- **Typed CRM Actions**: validated actions for creating and listing contacts, companies, and tasks
- **Operator Workspace**: thread list, message history, CRM snapshot, and action results in one screen
- **Barge-in Support**: interrupt spoken replies naturally

### 🌐 Multi-Tenant Architecture
- **Tenant-scoped data**: MongoDB reads and writes are scoped by `tenantId`
- **JWT or local dev auth**: production should use verified JWTs; local development can opt into dev auth

## Technical Architecture

### Backend (API)
- **Node.js/Express**: RESTful API with TypeScript
- **MongoDB**: Document-based storage with multi-tenant data isolation
- **Google Vertex AI**: Large language model integration for conversational AI
- **Typed CRM Actions**: server-validated actions rather than freeform prompt automation

### Frontend (Runtime UI)
- **React/TypeScript**: Modern web application with Vite build system
- **Voice Processing**: Real-time speech recognition and audio processing
- **GSAP Animations**: Smooth, professional user interface animations
- **Operator Console**: conversation history, CRM snapshot, and typed composer

## Getting Started

### Development Setup
```bash
# Install dependencies
pnpm install

# Start API + UI together
pnpm dev
```

If you only need one side during development:

```bash
pnpm dev:api
pnpm dev:ui
```

### Environment Configuration
The system requires:
- MongoDB connection
- `JWT_SECRET` for verified bearer tokens in non-dev environments
- Root `max/.env` is the default env source; set `API_ENV_OVERRIDE=true` only if you intentionally want `apps/api/.env` to override it
- Google Cloud Vertex AI credentials for AI planning
- `VERTEX_ENABLED=false` if you want local heuristic-only mode without Vertex auth
- `VERTEX_RETRY_COOLDOWN_MS` to control temporary backoff after Vertex auth/network errors
- `VERTEX_LOG_UNAVAILABLE=false` to suppress noisy Vertex fallback warnings in dev logs
- Optional local intent router via Ollama (`LOCAL_ROUTER_ENABLED`, `LOCAL_ROUTER_URL`, `LOCAL_ROUTER_MODEL`)
- `AI_TRACE_LOGS=true` to print per-request routing and model flow logs in API console
- `AGENT_TOOLS_CONFIG_PATH` points to the JSON tool registry (default `./config/agent-tools.json`)
- Google Cloud auth for TTS if you want server-side natural voice output
- Optional: `ALLOW_DEV_AUTH=true` for local development without a full auth system

### Agent Tools Registry
- Tool and ability configuration lives in `max/config/agent-tools.json`
- The API hot-reloads this file based on file timestamp, so edits do not require code changes
- Inspect effective registry at `GET /ai/tools`
- Supported `access.method` values:
  - `local.weather_open_meteo`
  - `local.time_lookup`
  - `crm.create_contact`, `crm.create_company`, `crm.create_task`
  - `crm.list_contacts`, `crm.list_companies`, `crm.list_tasks`

### Production Deployment
Max is designed for cloud deployment with proper authentication, tenant provisioning, and scalable infrastructure.

## System Status

**Current Version**: 1.0.0
**Development Status**: MVP hardening in progress
**Authentication**: verified JWT support plus opt-in local dev auth
**MVP Scope**: contacts, companies, tasks, thread history, typed AI actions, voice overlay
