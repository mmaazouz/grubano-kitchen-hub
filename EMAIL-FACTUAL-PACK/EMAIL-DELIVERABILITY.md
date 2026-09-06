# EMAIL-DELIVERABILITY — production-readiness facts (public DNS + read-only SMTP probe 2026-09-05 · **external Gmail proof 2026-09-06 = PASS**, see §6)

> **2026-09-06 update:** the external gate is now **CLOSED — PASS**: one QA message sent through the real transport reached the founder's Gmail **inbox** with SPF / DKIM (`d=grubano.com`, `s=default`) / DMARC all **PASS**, TLS 1.3 to Gmail. The Gmail-observed egress IP is **`109.234.163.45`** (o2switch relay, PTR `prout.jabatus.fr`, authorized by `include:spf.jabatus.fr`) — **not** `109.234.165.222` as previously expected. §1, §3–§6 and §8 are updated accordingly; the original 2026-09-05 analysis is kept for provenance.
>
> **Why this file exists (2026-09-05):** the only delivery evidence so far is local — `mail.grubano.com` accepting a recipient on its own domain (operator v2 preflight, 2026-09-04: "acceptation fournisseur imprimée ; inbox = NOT MEASURED"). That proves the MX accepts mail for `@grubano.com`; it proves **nothing** about Gmail / Microsoft / Orange placement. Nothing below was changed: no DNS write, no test send, no Stripe, no flag.

## 1 · Verdict block

| Check | Result | Basis |
|---|---|---|
| SMTP LOCAL DELIVERY | **PASS** | operator v2 test mail accepted by `mail.grubano.com` (founder-run, 2026-09-04); EHLO probe 2026-09-05: banner + `250` capabilities, `STARTTLS`, `AUTH PLAIN LOGIN`. Inbox placement of that local test = NOT MEASURED. |
| SPF | **PASS (record) · PASS (message, Gmail 2026-09-06) · alignment PASS** | single TXT record; Gmail: `spf=pass` for MAIL FROM `contact@grubano.com`, client IP `109.234.163.45` (authorized via `include:spf.jabatus.fr` → `ip4:109.234.163.0/24`, not via the `ip4:109.234.165.222` term). |
| DKIM | **PASS (message, Gmail 2026-09-06)** | Exim signs outbound app mail: Gmail `dkim=pass` with `d=grubano.com`, `s=default` (the published RSA-2048 key). Aligned with header From. |
| DMARC | **PASS (message, Gmail 2026-09-06) · policy p=none · no reporting** | Gmail `dmarc=pass`, satisfied by **both** aligned SPF and aligned DKIM. Policy still `v=DMARC1; p=none;` with no `rua` ⇒ enforcement and visibility remain the DNS should-fix below (not changed). |
| REVERSE DNS / PTR | **PASS** (egress `109.234.163.45` → `prout.jabatus.fr`, o2switch relay) | The actual egress toward Gmail is the o2switch relay `109.234.163.45`, not the submission host. Its PTR is an o2switch (jabatus.fr) name; Gmail accepted the message to the inbox. The submission host `109.234.165.222` (`109-234-165-222.reverse.odns.fr`, forward-confirmed) is no longer the relevant PTR for external delivery. |
| FROM / ENVELOPE ALIGNMENT | **PASS (measured on the wire, Gmail 2026-09-06)** | Header From `contact@grubano.com`, `Return-Path: <contact@grubano.com>`, DKIM `d=grubano.com` ⇒ exact-domain alignment for both SPF and DKIM (relaxed and strict). |
| EXTERNAL SMTP ACCEPTANCE | **PASS (Gmail, 2026-09-06)** | one QA message accepted by Exim (`250 OK id=1x32MK-0000000A4Fd-0Kzx`) and received by Gmail (§6). |
| EXTERNAL INBOX PLACEMENT | **PASS — INBOX (Gmail, 2026-09-06)** | Gmail placed the QA message in the inbox, not spam (founder measurement via "Show original"). One Gmail data point; Outlook / Orange not measured. |
| EXTERNAL TEST ADDRESS REQUIRED FROM FOUNDER | **PROVIDED (Gmail, 2026-09-06)** | founder-controlled Gmail mailbox, explicitly authorized for the one test. Outlook / Orange: optional later data points. |
| DELIVERABILITY PILOT GATE | **PASS — EMAIL BETA GATE CLOSED (2026-09-06)** | (a) DKIM signing proven, (b) external acceptance + inbox placement measured on Gmail, (c) SPF/DKIM/DMARC all PASS with alignment. Remaining **should-fix, not blocker**: DMARC `rua` reporting + enforcement path (founder-authorized DNS change, not done). |

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
| Sender infrastructure authorized | **YES — measured 2026-09-06:** the message reached Gmail from **`109.234.163.45`** (o2switch outbound relay, PTR `prout.jabatus.fr`), authorized by `include:spf.jabatus.fr` (`ip4:109.234.163.0/24`) ⇒ `spf=pass`. The submission host `mail.grubano.com` = `109.234.165.222` (listed by `ip4:`, `+a`, `+mx`) is **not** the egress IP for external delivery. **Consequence:** the `include:spf.jabatus.fr` term is load-bearing — never remove it. |
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
| Signature present on a real email | **PROVEN (Gmail, 2026-09-06)** — `dkim=pass header.i=@grubano.com header.s=default`. The signature is added by Exim on the server: the client-generated message (Nodemailer, no `dkim` option) carries no `DKIM-Signature` at submission. |
| `d=` domain | `grubano.com` (measured). |
| Alignment with From | **PASS** (same domain, measured). |
| Private key exposure | none in the repo (grep for `DKIM`/`PRIVATE KEY`: no hits outside `node_modules`). |
| Verdict | **DKIM = PASS (operational, 2026-09-06)** |

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
| Production state | **unsafe for a payments brand** (no enforcement, no visibility). Not a hard delivery blocker for low-volume senders, but Gmail/Yahoo bulk-sender rules (≥ 5 000/day) require a DMARC policy (any `p=`) and aligned SPF **or** DKIM — **both halves measured PASS on 2026-09-06** (`dmarc=pass`, via SPF and DKIM). |
| Remediation facts (for a later, founder-authorized DNS change — **not done**) | 1) add `rua=mailto:<monitored mailbox>` and observe ≥ 2 weeks; 2) confirm DKIM signing (cPanel *Email Deliverability* → domain shows "Valid" for DKIM/SPF); 3) move to `p=quarantine; pct=100` then `p=reject`; 4) consider `sp=` for subdomains; 5) optionally tighten SPF `~all` → `-all` **only after** every legitimate sender (o2switch relay ranges) is confirmed in the record. |

## 5 · Reverse DNS / PTR (measured)

| Fact | Value |
|---|---|
| Outbound IP (**measured 2026-09-06**) | **`109.234.163.45`** — Gmail's `client-ip` for the QA message. Exim on `muscadier` relays external mail through the o2switch outbound relay, **not** through the submission IP. The earlier expectation (`109.234.165.222`) was wrong for egress; it remains the submission host (`mail.grubano.com`). |
| PTR of the egress IP | **YES** → `prout.jabatus.fr` (o2switch relay naming; jabatus.fr = o2switch infrastructure, same zone as `spf.jabatus.fr`). |
| Submission host PTR (for reference) | `109.234.165.222` → `109-234-165-222.reverse.odns.fr`, forward-confirmed — not what Gmail sees. |
| EHLO / PTR consistency | Submission-side: EHLO `muscadier.o2switch.net`, PTR generic `reverse.odns.fr`, MX `mail.grubano.com` (cosmetic mismatch, same IP). Egress-side (what Gmail evaluates): relay `109.234.163.45` / `prout.jabatus.fr` — accepted to the inbox with TLS 1.3. |
| Control | shared hosting — PTR is controlled by the ISP (odns.fr / o2switch), **not by Grubano**. Cannot be set to `mail.grubano.com` without a dedicated IP. Recorded as a hosting limitation. |
| Port 25 from the audit machine | connection timed out (local ISP egress block) — not a server fact. |

## 6 · External delivery proof — **MEASURED 2026-09-06 · PASS**

### 6.1 · The one message (server side, measured by the operator)

| Fact | Value |
|---|---|
| Send time (UTC) | 2026-09-06T02:11:36.700Z |
| Transport | the real product transport — identical config to `lib/transactional-emails.ts`: host `mail.grubano.com` (109.234.165.222, Exim 4.99.5, banner `muscadier.o2switch.net`), port 587, STARTTLS, AUTH `contact@grubano.com` (`235 Authentication succeeded`), Nodemailer 7.0.13. No other provider, no test SMTP service, no console transport. |
| From | `"Grubano" <contact@grubano.com>` |
| Envelope (MAIL FROM) | `contact@grubano.com` (Nodemailer default = From) |
| Recipient | founder-controlled Gmail mailbox (explicitly authorized; address not recorded here) |
| Subject | `[QA Grubano] Test de délivrabilité pré-bêta` |
| Body | minimal FR text + HTML (« Bonjour, Ceci est un email de test de délivrabilité pré-bêta Grubano. Aucune action n'est requise. L'équipe Grubano ») — no customer/order data |
| SMTP result | RCPT `250 Accepted` · DATA **`250 OK id=1x32MK-0000000A4Fd-0Kzx`** |
| Message-ID | `<73e4da…@grubano.com>` (masked) |
| DKIM at submission | **absent** on the client-generated message (the app's Nodemailer has no `dkim` option) → signing is server-side (Exim) |
| Side effects | none: one-shot operator without Prisma, Stripe or any product route; no EmailLog row; no order/user/restaurant/refund/loyalty/claim/DNS/flag mutation |
| Retries | none (exactly one message) |

### 6.2 · Gmail "Show original" (founder measurement, authoritative)

| Fact | Value |
|---|---|
| MESSAGE RECEIVED | **YES** |
| PLACEMENT | **INBOX** (Gmail/upstream spam verdict: NOT SPAM) |
| SPF | **PASS** — MAIL FROM `contact@grubano.com`, client IP **`109.234.163.45`** |
| DKIM | **PASS** — `d=grubano.com`, `s=default` |
| DMARC | **PASS** — policy `p=none`; pass via **both** aligned SPF and aligned DKIM |
| Header From domain | `grubano.com` |
| Return-Path | `<contact@grubano.com>` (domain `grubano.com`) |
| SPF alignment / DKIM alignment | PASS / PASS (exact domain) |
| TLS to Gmail | PASS (TLS 1.3) |

### 6.3 · Factual correction
The 2026-09-05 analysis expected `109.234.165.222` (the submission host) to be the outbound IP. **Gmail observed `109.234.163.45`** — an o2switch outbound relay (PTR `prout.jabatus.fr`), authorized by `include:spf.jabatus.fr` (`ip4:109.234.163.0/24`). SPF passed because of that include, not because of the `ip4:109.234.165.222` term. Any future SPF edit (founder-authorized only) must keep `include:spf.jabatus.fr`. No DNS was changed.

### 6.4 · Classification
**DELIVERABILITY AUTHENTICATION = PASS · INBOX PLACEMENT = PASS · DELIVERABILITY PILOT GATE = PASS · EMAIL BETA GATE = CLOSED.** Scope of the proof: one message, one Gmail mailbox, transactional volume. Not measured: Outlook / Orange placement, reputation under volume, forwarding scenarios. Repeat the same one-shot test (one message, founder mailbox, "Show original") after any DNS, hosting or From-domain change.

## 7 · Sending-volume and reputation facts
- Volumes are tiny (closed beta) — no bulk-sender thresholds apply today.
- Egress is the shared o2switch relay (`109.234.163.45` measured; the `spf.jabatus.fr` ranges in general) ⇒ reputation is **shared and not controllable**; the o2switch banner forbids unsolicited/bulk mail.
- No feedback loops, no bounce processing, no suppression list → a bad address is retried at every event (dedupe is per event, not per address).

## 8 · Severity classification
- ~~PRE-PRODUCTION BLOCKER (proof gap)~~ **CLOSED 2026-09-06:** external acceptance + inbox placement measured on Gmail; DKIM signing confirmed (`d=grubano.com`, `s=default`); SPF/DMARC PASS with alignment.
- **PRE-PRODUCTION SHOULD-FIX (DNS, founder-authorized change):** DMARC `rua` reporting; enforcement path `none → quarantine → reject` after monitoring.
- **HOSTING LIMITATION (accept or change hosting):** shared relay IP reputation (`109.234.163.45`, PTR `prout.jabatus.fr`), submission-side EHLO ≠ MX name. Accepted by Gmail to the inbox on 2026-09-06.
- **CODE (implementation handoff):** `requireTLS`, single sender module, Reply-To, List-Unsubscribe for the nudge family, plain-text parts, `<html lang>` wrapper.
