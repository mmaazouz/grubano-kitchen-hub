# E1-B-HANDOFF — AUTH FAMILY EXPANSION (future Claude Design session — NOT STARTED)

> **REQUIRES APPROVED E1-A SYSTEM CONTRACT** (`CLAUDE-DESIGN-GRUBANO-EMAIL-SYSTEM-CONTRACT.md`). No new visual language, button system or footer — family-specific adaptation only. Facts: `../EMAIL-MANIFEST.md §1`, copy `../EMAIL-COPY-VERBATIM.md §A`, contracts `../EMAIL-DATA-CONTRACTS.md §1/§4`, fossils `../current-renders/`, auth mechanics `../EMAIL-AUTH-FACTS.md`, rules `../EMAIL-DESIGN-SYSTEM-FACTS.md`.

| ID | Status | Notes for the design |
|---|---|---|
| AUTH_MAGIC_LINK_WITH_OTP | B (flag) | already covered as the code state of E1-A — reuse |
| AUTH_PASSWORD_RESET | A | 1 h single-use link; email in query string today (P2); formal French already |
| AUTH_PASSWORD_CHANGED | A | security notice; state the support path |
| CONSUMER_WELCOME | A | no « réserver une table » (sur place OUT); CTA on the deployment base (today hardcoded prod); tu → vous |
| AUTH_STEPUP_CODE · ACCOUNT_EMAIL_CHANGE_CODE | B (flags) | same code block as E1-A; 10 min |
| ACCOUNT_EMAIL_CHANGE_LINK · CHANGED_ALERT · CHANGE_CONFIRM · ALREADY_USED | B (flag) | link 15 min; alert must name the support channel |

Out of scope: any non-auth email; Claims; Refunds. Deliverables: per-email HTML references on the contract, gallery, subject/preheader table, plain-text, conditional states (empty name, code present/absent).
