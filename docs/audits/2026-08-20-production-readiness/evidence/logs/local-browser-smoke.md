# Local anonymous browser smoke

Candidate: `88b9baca35be5b8d9235b2f96863150ef3a67ad1`  
Date: 2026-08-20  
Target: fresh `BUILD_TARGET=node npm run build`, `npm start`, loopback only

| Route | HTTP | Screenshot sizes | Result |
|---|---:|---|---|
| `/` | 200 | 1440×900, 390×844 | Rendered; public content remains visually thin. |
| `/login` | 200 | 1440×900, 390×844 | Rendered; no discoverable forgot-password control. |
| `/signup` | 200 | 1440×900, 390×844 | Rendered without a gross error page. |
| `/privacy` | 200 | 1440×900, 390×844 | Rendered without a gross error page. |
| `/eula` | 200 | 1440×900, 390×844 | Rendered without a gross error page. |
| `/healthz` | 200 | none | Returned `{"ok":true}` without checking configuration or database health. |

The in-app Browser setup failed before navigation with:

```text
Browser use requires a trusted Node REPL browser service
```

The fallback used `npx --yes playwright@1.55.0` with the installed Chrome
executable. It did not install or change application dependencies. No authenticated
session, user data, provider credentials, production host, destructive action,
keyboard flow, assistive technology, or automated accessibility scan was involved.

