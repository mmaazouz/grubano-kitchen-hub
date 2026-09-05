# EMAIL-DELIVERABILITY — production-readiness facts (public DNS + read-only SMTP probe, 2026-09-05)

> **Why this file exists:** the only delivery evidence so far is local — `mail.grubano.com` accepting a recipient on its own domain (operator v2 preflight, 2026-09-04: "acceptation fournisseur imprimée ; inbox = NOT MEASURED"). That proves the MX accepts mail for `@grubano.com`; it proves **nothing** about Gmail / Microsoft / Orange placement. Nothing below was changed: no DNS write, no test send, no Stripe, no flag.

## 1 · Verdict block

| Check | Result | Basis |
|---|---|---|
| SMTP LOCAL DELIVERY | **PASS** | operator v2 test mail accepted by `mail.grubano.com` (founder-run, 2026-09-04); EHLO probe 2026-09-05: banner + `250` capabilities, `STARTTLS`, `AUTH PLAIN LOGIN`. Inbox placement of that local test = NOT MEASURED. |
| SPF | **PASS (record) · alignment PASS by construction · runtime result NOT PROVEN** | single TXT record, syntactically valid, sending IP explicitly authorized (below). No `Received-SPF` header observed yet. |
| DKIM | **NOT PROVEN** | public key published under selector `default` (RSA 2048, cPanel default). Whether Exim **signs** outbound app mail = unknown until a received message shows a `DKIM-Signature` and `Authentication-Results`. |
| DMARC | **PRESENT · p=none · NOT PROVEN (no aggregate reports)** | `_dmarc.grubano.com` = `v=DMARC1; p=none;` — monitoring policy with **no `rua`** ⇒ zero visibility. |
| REVERSE DNS / PTR | **PASS (generic)** | `109.234.165.222` → `109-234-165-222.reverse.odns.fr`, forward-confirmed (A → same IP). Generic ISP name, ≠ EHLO name `muscadier.o2switch.net`, ≠ `mail.grubano.com` — acceptable to Gmail's "valid forward and reverse DNS" rule, sub-optimal for reputation. |
| FROM / ENVELOPE ALIGNMENT | **PASS by construction · NOT PROVEN on the wire** | From `contact@grubano.com`; envelope = From (Nodemailer default); expected DKIM `d=grubano.com` (cPanel signs with the sending domain) ⇒ relaxed alignment on both. Actual `Return-Path` / `d=` = NOT MEASURED. |
| EXTERNAL SMTP ACCEPTANCE | **NOT PROVEN** | no external mailbox exists in the repo/QA setup (see §6). |
| EXTERNAL INBOX PLACEMENT | **NOT MEASURED** | idem. |
| EXTERNAL TEST ADDRESS REQUIRED FROM FOUNDER | **YES** | one Gmail / Outlook / Orange address controlled by the founder. |
| DELIVERABILITY PRE-PROD BLOCKER | **YES** — *unproven*, not proven-broken | (a) DKIM signing unverified, (b) no external acceptance/placement measurement, (c) DMARC without reporting. Authentication records exist; nothing is *missing* at the DNS level except DMARC reporting. |

## 2 · SPF (measured, resolver 8.8.8.8)

```
grubano.com.          TXT  "v=spf1 ip4:109.234.165.222 +a +mx +include:spf.jabatus.fr ~all"
app.grubano.com.      TXT  "v=spf1 +a +mx +ip4:109.234.165.222 ~all"
business.grubano.com. TXT  "v=spf1 +a +mx +ip4:109.234.165.222 ~all"
spf.jabatus.fr.       TXT  "v=spf1 ip4:109.234.163.0/24 ip4:23.83.208.0/20 ip4:46.232.183.0/24 ip4:199.10.31.235/32 ip4:199.10.31.236/32 ip4:172.255.62.10/32 ip4:172.255.62.11/32 ip4:54.245.125.39/32 ip4:103.18.109.138/32 ip4:54.214.232.113/32 ~all"
```

| Fact | Value |
|---|---|
| SPF record present | YES (exactly **1** TXT starting `v=spf1` on `grubano.com` — no duplicate-record failure) |
| Classification | o2switch/cPanel default shape (`+a +mx` + host IP) plus the o2switch outbound relay include (`spf.jabatus.fr` = o2switch infrastructure). |
| Sender infrastructure authorized | **YES** — the app's SMTP host `mail.grubano.com` = `muscadier.o2switch.net` = `109.234.165.222`, listed by `ip4:`, and covered by `+a` (apex A = same IP) and `+mx`. If o2switch relays outbound via other ranges, `spf.jabatus.fr` covers them. |
| Multiple SPF records | NO |
| Syntax / evaluation issue | NO. DNS-lookup count: `a`(1) + `mx`(1 + 1 A lookup) + `include`(1) ≈ 4 ≤ 10. `~all` = **softfail** (not `-all`). |
| Alignment implication | Envelope domain = `grubano.com` = From domain ⇒ DMARC SPF alignment (relaxed **and** strict) PASS whenever SPF passes. Subdomain records exist for `app.` and `business.` but the app never sends from those (From is always the apex). |

## 3 · DKIM (measured)

```
default._domainkey.grubano.com. TXT "v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA2poGocze8w+…"   (p = 392 base64 chars → 294-byte SubjectPublicKeyInfo ⇒ RSA-2048)
```

| Fact | Value |
|---|---|
| Selector(s) | `default` (cPanel convention) — present. Probed and **absent**: `mail`, `dkim`, `google`, `selector1`, `selector2`, `k1`, `s1`, `s2`, `x`, `cpanel`. No `_domainkey` policy record. |
| Public key | present, 2048-bit RSA, no `t=y` test flag, no `s=email` restriction visible in the fetched prefix. |
| Signature present on a real email | **NOT PROVEN** — no captured outbound message. cPanel's Exim signs with `default` when "DKIM" is enabled in *Email Deliverability*; that setting is a cPanel-UI fact, NOT MEASURED. |
| `d=` domain | expected `grubano.com` (From domain) — NOT MEASURED. |
| Alignment with From | expected PASS (same domain). |
| Private key exposure | none in the repo (grep for `DKIM`/`PRIVATE KEY`: no hits outside `node_modules`). |
| Verdict | **DKIM = NOT PROVEN** |

## 4 · DMARC (measured)

```
_dmarc.grubano.com. TXT "v=DMARC1; p=none;"   (exactly 1 record)
```

| Fact | Value |
|---|---|
| Record present | YES, syntactically valid (minimal). |
| Policy | `p=none` (monitor only — receivers apply no action on failure). |
| Subdomain policy | not set ⇒ inherits `none`. |
| Alignment mode | `adkim` / `aspf` not set ⇒ **relaxed** both. |
| Reporting | **no `rua`, no `ruf`** ⇒ Grubano receives no aggregate reports; there is no way to observe alignment failures, spoofing or forwarding breakage. |
| Percentage | not set ⇒ 100 %. |
| Production state | **unsafe for a payments brand** (no enforcement, no visibility). Not a hard delivery blocker for low-volume senders, but Gmail/Yahoo bulk-sender rules (≥ 5 000/day) require a DMARC policy (any `p=`) and aligned SPF **or** DKIM — the aligned-DKIM half is unproven. |
| Remediation facts (for a later, founder-authorized DNS change — **not done**) | 1) add `rua=mailto:<monitored mailbox>` and observe ≥ 2 weeks; 2) confirm DKIM signing (cPanel *Email Deliverability* → domain shows "Valid" for DKIM/SPF); 3) move to `p=quarantine; pct=100` then `p=reject`; 4) consider `sp=` for subdomains; 5) optionally tighten SPF `~all` → `-all` **only after** every legitimate sender (o2switch relay ranges) is confirmed in the record. |

## 5 · Reverse DNS / PTR (measured)

| Fact | Value |
|---|---|
| Outbound IP (expected) | `109.234.165.222` — the SMTP host the app authenticates to. Whether Exim relays outbound through the same IP or an o2switch relay = NOT MEASURED (a received `Received:` header would show it). |
| PTR exists | **YES** → `109-234-165-222.reverse.odns.fr` |
| Forward-confirmed (FCrDNS) | **YES** — `109-234-165-222.reverse.odns.fr` A → `109.234.165.222` |
| EHLO / PTR consistency | **MISMATCH (cosmetic)**: server EHLO = `muscadier.o2switch.net` (A → same IP), PTR = generic `reverse.odns.fr` name, MX name = `mail.grubano.com`. All three resolve to the same IP. |
| Control | shared hosting — PTR is controlled by the ISP (odns.fr / o2switch), **not by Grubano**. Cannot be set to `mail.grubano.com` without a dedicated IP. Recorded as a hosting limitation. |
| Port 25 from the audit machine | connection timed out (local ISP egress block) — not a server fact. |

## 6 · External delivery proof

**Discovery result — no safe external QA mailbox exists.** Searched `.env.example`, `scripts/`, `docs/`, `tests/`, `README`, `CLAUDE.md` for `gmail|outlook|hotmail|orange.fr|yahoo|QA_EMAIL|TEST_EMAIL|EXTERNAL`. Findings: the QA tooling **refuses** non-test-ish addresses (`QA_EMAIL` must carry `+qa` or end in `.test`/`.qa`, `scripts/qa/README.md:61`); the only external-domain strings are unit-test fixtures (`tests/customer-initials.test.ts:65`, `tests/customer-scope.test.ts:67`) — one of them is a personal Gmail belonging to the founder and was **not used** (personal data, not a QA mailbox). `ALERT_EMAIL` on staging is an `@grubano.com` address (local delivery only).

Therefore: **EXTERNAL DELIVERY PROOF = FOUNDER GATE REQUIRED · EXTERNAL TEST ADDRESS NEEDED = YES.** No test email was sent in this session.

### 6.1 · The one-shot test to run once an address is provided (spec, not executed)
- Sender: the **staging** app transport (same `SMTP_*`), From `"Grubano" <contact@grubano.com>`.
- Subject: `[GRUBANO STAGING] Deliverability test — <YYYY-MM-DD>`; body: one paragraph, no customer/order data, HTML + text.
- Exactly **one** message per external domain (Gmail, Outlook, Orange as available). No template fan-out.
- Capture: SMTP `250` response line (queue id), then from the recipient mailbox: `Authentication-Results` (spf=, dkim= with `d=` and selector `s=`, dmarc=), `Received-SPF`, `Return-Path`, `DKIM-Signature`, folder (Inbox / Spam / Promotions). Gmail: "Show original" also displays SPF/DKIM/DMARC PASS/FAIL lines.
- Implementation hint: `scripts/server/phase2-preflight.js:383-384` already contains a minimal one-off `sendMail` using the app transport; a dedicated `scripts/ops/deliverability-test.js` should copy that pattern (guarded: refuses to run without an explicit recipient argument, prints the SMTP response, never loops).

## 7 · Sending-volume and reputation facts
- Volumes are tiny (closed beta) — no bulk-sender thresholds apply today.
- One IP shared with every other o2switch tenant on `muscadier` ⇒ reputation is **shared and not controllable**; the o2switch banner forbids unsolicited/bulk mail.
- No feedback loops, no bounce processing, no suppression list → a bad address is retried at every event (dedupe is per event, not per address).

## 8 · Severity classification
- **PRE-PRODUCTION BLOCKER (proof gap):** external acceptance + placement measurement; DKIM signing confirmation.
- **PRE-PRODUCTION SHOULD-FIX (DNS, founder-authorized change):** DMARC `rua` reporting; enforcement path `none → quarantine → reject` after monitoring.
- **HOSTING LIMITATION (accept or change hosting):** generic PTR, shared IP reputation, EHLO ≠ MX name.
- **CODE (implementation handoff):** `requireTLS`, single sender module, Reply-To, List-Unsubscribe for the nudge family, plain-text parts, `<html lang>` wrapper.
