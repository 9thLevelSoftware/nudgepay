# NudgePay — Architecture Diagrams

**Date:** 2026-06-22
**Companion to:** `2026-06-22-nudgepay-production-rebuild-design.md`
**Format:** Mermaid (renders on GitHub and most Markdown viewers)

These diagrams show expected dataflow, the auth model, the trust boundary, and
the backend QBO/Twilio integrations for the rebuilt NudgePay. The core security
invariant across all of them: **the browser only talks to the app's own server
routes; it never holds the Supabase service-role key and never calls
QBO/Twilio/Supabase-admin directly.**

---

## 1. System Topology / Deployment

How the deployed pieces relate. One Cloudflare Worker runs the whole React
Router v7 app (UI + server loaders/actions + resource routes). Supabase holds
identity and data. QBO and Twilio are external; they both call *in* (webhooks)
and get called *out* (REST).

```mermaid
flowchart LR
    subgraph Client["Browser (untrusted)"]
        UI["React Router v7 UI<br/>(TypeScript)"]
    end

    subgraph CF["Cloudflare"]
        Worker["RR7 Worker<br/>loaders / actions / resource routes"]
        Cron["Cron Trigger<br/>(CDC catch-up ~15-30m)"]
        Secrets["Worker Secrets<br/>service-role key, AES key,<br/>QBO + Twilio creds"]
    end

    subgraph Supa["Supabase"]
        Auth["Supabase Auth<br/>(JWT issuer)"]
        PG["Postgres<br/>(RLS on every table)"]
    end

    QBO["QuickBooks Online API"]
    Twilio["Twilio<br/>(Messaging Service)"]

    UI -->|HTTPS, app routes only| Worker
    UI -->|login / token| Auth
    Worker -->|user-scoped JWT + service-role| PG
    Worker -->|verify JWT| Auth
    Worker -->|OAuth + REST sync| QBO
    Worker -->|REST send| Twilio
    QBO -->|change webhooks| Worker
    Twilio -->|inbound + status webhooks| Worker
    Cron -->|trigger CDC| Worker
    Secrets -.->|injected at runtime| Worker

    classDef trust fill:#FDECEA,stroke:#C0202A;
    classDef safe fill:#E8EFF9,stroke:#1B3A6B;
    class Client trust;
    class CF,Supa safe;
```

---

## 2. Frontend Architecture & Dataflow

The browser renders RR7 route components. Data is loaded/mutated via **server**
loaders and actions that execute **inside the Worker** — that server step is the
trust boundary. Normal data access uses a **user-scoped** Supabase client
(carrying the logged-in user's JWT), so Postgres RLS scopes every row to the
user's org. The service-role client is reachable only from privileged server
code paths (sync, webhooks, token storage), never from a browser request.

```mermaid
flowchart TD
    subgraph Browser["Browser (untrusted)"]
        Route["Route component<br/>(dashboard, threads, settings)"]
        Form["Form / fetcher"]
    end

    subgraph WorkerSrv["Cloudflare Worker (trusted server)"]
        Loader["loader()<br/>read data"]
        Action["action()<br/>mutations: log contact,<br/>send text, connect QBO"]
        Guard["requireSession()<br/>validate JWT, resolve org"]
        UserClient["Supabase client<br/>(user JWT)"]
        SvcClient["Supabase client<br/>(service role)"]
    end

    PG[("Postgres<br/>RLS by org_id")]

    Route -->|navigation / GET| Loader
    Form -->|POST| Action
    Loader --> Guard
    Action --> Guard
    Guard --> UserClient
    UserClient -->|RLS-scoped read/write| PG
    Action -. privileged jobs only .-> SvcClient
    SvcClient -->|bypasses RLS, server-only| PG
    Loader -->|typed data| Route
    Action -->|redirect / typed result| Route

    classDef trust fill:#FDECEA,stroke:#C0202A;
    classDef safe fill:#E8EFF9,stroke:#1B3A6B;
    class Browser trust;
    class WorkerSrv safe;
```

---

## 3. Auth & Multi-Tenant Access (RLS)

Signup creates a user (Supabase Auth), then an org, then a membership linking
them. The JWT issued on login is presented on every subsequent server request;
the Worker validates it and uses it for a user-scoped Supabase client, so RLS
policies filter every query to rows whose `org_id` the user belongs to.

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant W as RR7 Worker
    participant A as Supabase Auth
    participant DB as Postgres (RLS)

    Note over B,DB: Signup / org creation
    B->>A: sign up (email/password or magic link)
    A-->>B: user + session JWT
    B->>W: POST /onboarding (create org)
    W->>DB: insert organizations + memberships(owner)
    DB-->>W: org_id
    W-->>B: redirect to dashboard

    Note over B,DB: Invite teammate
    B->>W: POST /invite (email)
    W->>A: create/invite user
    W->>DB: insert membership(org_id, member)

    Note over B,DB: Every authed request
    B->>W: request + JWT (cookie/header)
    W->>A: verify JWT
    A-->>W: valid (user_id)
    W->>DB: query with user JWT
    DB-->>W: only rows where user in membership(org_id)
    W-->>B: typed, org-scoped data
```

---

## 4. Backend — QuickBooks OAuth & Sync

OAuth connect uses a real CSRF nonce and a redirecting callback (no HTML, no
leaked params). Tokens are AES-GCM encrypted before storage, per org. Sync is
webhook-primary with a bounded CDC catch-up on a cron, plus a manual refresh —
all writing idempotent upserts.

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant W as RR7 Worker
    participant Q as QuickBooks Online
    participant DB as Postgres

    Note over B,DB: Connect (OAuth 2.0)
    B->>W: GET /auth/qbo (org context)
    W->>W: generate + store CSRF nonce (TTL)
    W-->>B: redirect to Intuit consent
    B->>Q: authorize
    Q-->>W: GET /auth/qbo/callback?code&realmId&state
    W->>W: verify state == stored nonce
    W->>Q: exchange code -> tokens
    Q-->>W: access + refresh token
    W->>W: AES-GCM encrypt tokens + realmId
    W->>DB: upsert qbo_connections (per org)
    W-->>B: redirect into app (no params rendered)

    Note over B,DB: Sync paths (idempotent upserts by qbo_id)
    Q->>W: POST /webhooks/qbo (signed change event)
    W->>W: verify signature
    W->>Q: fetch changed entities
    W->>DB: upsert customers / invoices (org-scoped)
    Note over W,Q: Cron Trigger -> CDC catch-up (<=30d, <=1000 obj)
    B->>W: POST manual "Refresh from QuickBooks"
    W->>Q: query overdue invoices
    W->>DB: upsert

    Note over W,Q: Disconnect
    B->>W: POST /qbo/disconnect
    W->>Q: revoke token (QBO_REVOKE_URL)
    W->>DB: clear qbo_connections row
```

---

## 5. Backend — Twilio SMS

Outbound texts send via the org's messaging config (or the shared platform
sender), recording the Twilio SID. Inbound replies and delivery/status callbacks
arrive as signature-verified webhooks and update the per-invoice thread. STOP/HELP
opt-out is honored via the Messaging Service.

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant W as RR7 Worker
    participant T as Twilio
    participant C as Customer phone
    participant DB as Postgres

    Note over B,DB: Outbound
    B->>W: POST /api/text/send (authed, invoice thread)
    W->>W: check sms_consent
    W->>T: send via Messaging Service
    T-->>W: message SID (queued)
    W->>DB: insert text_messages (sid, status, sent_by_user_id, org_id)
    T->>C: SMS delivered

    Note over T,DB: Status callbacks
    T->>W: POST /webhooks/twilio/status (signed)
    W->>DB: update status / error_code by SID

    Note over C,DB: Inbound reply
    C->>T: reply (or STOP / HELP)
    T->>W: POST /webhooks/twilio/inbound (signed)
    W->>W: verify signature; STOP -> set opt-out
    W->>DB: insert inbound text_messages, match to thread
    W-->>B: reply appears in iMessage-style UI
```

---

## 6. Multi-Tenant Data Model

`organizations` is the tenant root; `memberships` links Supabase Auth users to
orgs. Every domain table carries `org_id` and is governed by RLS. `qbo_connections`
(per org) replaces the old single-row `qbo_sync_state`; `messaging_config` (per
org) enables future per-tenant Twilio senders.

```mermaid
erDiagram
    organizations ||--o{ memberships : has
    organizations ||--o{ customers : owns
    organizations ||--o{ invoices : owns
    organizations ||--o{ contact_logs : owns
    organizations ||--o{ text_messages : owns
    organizations ||--|| qbo_connections : has
    organizations ||--o| messaging_config : has
    auth_users ||--o{ memberships : "is member via"
    auth_users ||--o{ contact_logs : "logged by"
    auth_users ||--o{ text_messages : "sent by"
    customers ||--o{ invoices : "billed for"
    customers ||--o{ contact_logs : "about"
    invoices ||--o{ contact_logs : "about"
    invoices ||--o{ text_messages : "thread"

    organizations {
        uuid id PK
        text name
        timestamptz created_at
    }
    memberships {
        uuid id PK
        uuid org_id FK
        uuid user_id FK
        text role "owner | member"
    }
    auth_users {
        uuid id PK
        text email
    }
    qbo_connections {
        uuid id PK
        uuid org_id FK
        text realm_id
        bytea access_token_enc
        bytea refresh_token_enc
        timestamptz token_expires_at
        timestamptz last_cdc_time
        text status
    }
    messaging_config {
        uuid id PK
        uuid org_id FK
        text messaging_service_sid
        text sender
    }
    customers {
        uuid id PK
        uuid org_id FK
        text qbo_id
        text name
        text email
        text phone
        bool sms_consent
    }
    invoices {
        uuid id PK
        uuid org_id FK
        text qbo_id
        text qbo_doc_number
        uuid customer_id FK
        numeric amount
        numeric balance
        date due_date
        text status
    }
    contact_logs {
        uuid id PK
        uuid org_id FK
        uuid invoice_id FK
        uuid user_id FK
        text method
        text outcome
        text notes
        date follow_up_at
    }
    text_messages {
        uuid id PK
        uuid org_id FK
        uuid invoice_id FK
        uuid sent_by_user_id FK
        text direction
        text twilio_message_sid
        text status
        text error_code
        text from_number
        text to_number
        text body
    }
```
