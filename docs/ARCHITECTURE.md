# SahAI Architecture Documentation

## 1. System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        USER (WhatsApp)                      │
└───────────────────────────┬─────────────────────────────────┘
                            │ WhatsApp Business API
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                     TWILIO GATEWAY                          │
│              (webhook: POST /api/webhook)                   │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   WEBHOOK HANDLER                           │
│  • Parse incoming message (text/voice/image/location)       │
│  • Voice → Whisper transcription                            │
│  • Image → GPT-4o Vision analysis                           │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                     ORCHESTRATOR                            │
│                                                             │
│  Tier 1: Emergency keyword check  (< 1ms, rule-based)      │
│  Tier 2: Menu/greeting matching   (< 1ms, regex)           │
│  Tier 3: Active session agent     (< 1ms, DB lookup)       │
│  Tier 4: LLM intent classification (200-500ms)             │
│                                                             │
│  Routes to: HealthAgent | SchemeAgent | EduAgent | Emergency│
└───┬───────────┬───────────┬───────────┬─────────────────────┘
    │           │           │           │
    ▼           ▼           ▼           ▼
┌────────┐ ┌────────┐ ┌────────┐ ┌──────────┐
│ Health │ │ Scheme │ │  Edu   │ │Emergency │
│ Agent  │ │ Agent  │ │ Agent  │ │  Agent   │
└───┬────┘ └───┬────┘ └───┬────┘ └────┬─────┘
    │          │          │           │
    └──────────┴──────────┴───────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│                  CONTEXT ASSEMBLY ENGINE                     │
│                                                             │
│  1. SOUL.md (bot personality)                               │
│  2. USER.md (user profile + medical history)                │
│  3. MEMORY.md (curated long-term knowledge)                 │
│  4. Working Memory (session notes)                          │
│  5. Short-term Memory (last 20 messages)                    │
│  6. RAG Context (if applicable)                             │
│  7. Tool Definitions (MCP protocol)                         │
│  8. Active Reminders                                        │
│                                                             │
│  All assembled → Single LLM prompt                          │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    TOOL CALLING LOOP                         │
│                                                             │
│  1. Send context + tools to OpenAI GPT-4o                   │
│  2. If response contains tool_calls:                        │
│     a. Validate arguments (Zod schema)                      │
│     b. Execute tool via ToolRegistry                        │
│     c. Feed results back to LLM                             │
│     d. Repeat (max 5 iterations)                            │
│  3. Return final text response                              │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    POST-PROCESSING                          │
│                                                             │
│  • Record bot response to DB + short-term memory            │
│  • Queue message for RAG indexing                           │
│  • Promote working memory to MEMORY.md if important         │
│  • Send response via Twilio → WhatsApp                      │
└─────────────────────────────────────────────────────────────┘
```

## 2. Memory System (5 Layers)

```
Layer 1: SHORT-TERM MEMORY (in-memory)
├── Last 20 messages per session
├── Fastest access (< 0.1ms)
├── Lost on server restart
└── Used for: multi-turn conversation context

Layer 2: WORKING MEMORY (in-memory)
├── Session scratch notes (extracted observations)
├── Categorized: symptom, preference, fact, intent, action
├── Importance-scored (0-1)
└── Used for: agent context during conversation

Layer 3: LONG-TERM MEMORY (file-backed)
├── MEMORY.md — Curated important facts
│   ├── Organized by category (Health, Preferences, etc.)
│   └── Human-readable, LLM-injectable
├── memory/YYYY-MM-DD.md — Daily raw logs
│   ├── Timestamped entries
│   └── Periodically distilled → MEMORY.md
└── Used for: persistent knowledge across sessions

Layer 4: PROFILE FILES (file-backed)
├── USER.md — User preferences, medical history, contacts
├── SOUL.md — Bot personality and guardrails
├── TOOLS.md — Available integrations and notes
└── Used for: identity and configuration

Layer 5: HEARTBEAT STATE (file-backed)
├── heartbeat-state.json — Scheduled reminders
├── Medication reminders, appointment reminders
├── Follow-up checks
└── Used for: proactive outreach
```

## 3. Tool Calling Architecture (MCP)

17 tools across 4 domains:

| Domain | Tool | Purpose |
|--------|------|---------|
| Healthcare | symptom_analyzer | Triage symptoms → urgency level |
| Healthcare | hospital_finder | Find nearby hospitals |
| Healthcare | appointment_booker | Book appointments |
| Healthcare | medication_reminder | Schedule WhatsApp reminders |
| Healthcare | health_record_manager | Store/retrieve health data |
| Government | scheme_search | Find relevant schemes |
| Government | eligibility_checker | Verify qualification |
| Government | application_tracker | Track application status |
| Government | document_helper | List required documents |
| Education | content_retriever | Fetch learning content |
| Education | quiz_generator | Generate quizzes |
| Education | progress_tracker | Track learning progress |
| Education | resource_fetcher | Deliver PDF/video resources |
| Emergency | emergency_dispatcher | Dispatch 108/100/101 |
| Emergency | location_tracker | GPS location handling |
| Emergency | contact_notifier | Alert emergency contacts |
| Emergency | resource_mapper | Find nearest services |

## 4. Design Decisions

### Why agent-based (not a single monolithic bot)?
Each domain has unique requirements. Health needs disclaimers; emergency needs speed; education needs a teaching style. Agents isolate these concerns.

### Why file-backed memory (not just database)?
Files are human-readable, LLM-injectable, git-trackable, and exportable. A user can request their data and get a zip of readable markdown files.

### Why rule-based emergency detection (not LLM)?
LLM inference takes 200-500ms. In emergencies, every millisecond counts. Rule-based keyword matching is instant and deterministic — it will NEVER miss "chest pain" even if the LLM is overloaded.

### Why SQLite (not PostgreSQL)?
Zero setup for a hackathon. The schema and queries are standard SQL, so migration to Postgres is trivial (change the driver, keep the queries).

### Why Twilio (not Meta Cloud API)?
Instant sandbox access. Meta requires business verification that takes days. Twilio lets you test in minutes.
