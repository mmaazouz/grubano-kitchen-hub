# E1-B-DESIGN-BRIEF — auth & account family as instances of the approved system

## Family character
Security and account emails: calm, precise, one action, formal French. Every email answers three questions in this order — what happened or what to do · how long it is valid / what it changes · what to do if it wasn't you (support `contact@grubano.com`). Never promotional; the welcome email is the only warm one, and it stays truthful to the beta.

## Semantics per email (contract status bands: SUCCESS · ACTION REQUIRED · NEUTRAL · WARNING · URGENT)

| Email | Band | Must show | Must not |
|---|---|---|---|
| AUTH_MAGIC_LINK_WITH_OTP (dormant) | ACTION REQUIRED | the E1-A magic link with the code block; « ce lien est valable 15 minutes, le code 10 minutes, chacun utilisable une seule fois » | a single validity sentence covering both |
| AUTH_PASSWORD_RESET | ACTION REQUIRED | button « Choisir un nouveau mot de passe » + copyable URL; « valable 1 heure, utilisable une seule fois »; ignore-if-not-you; support line | email address echoed in the body |
| AUTH_PASSWORD_CHANGED | WARNING (security) | what changed; « si ce n'est pas vous » → reset path (« Mot de passe oublié » on the login page) + support address | reassurance without a next step |
| CONSUMER_WELCOME | SUCCESS (warm) | account active; what the beta offers: commander en Click & collect, points fidélité; CTA « Découvrir les restaurants » (deployment base URL); ignore-if-not-you | « réserver une table » (sur place OUT), delivery, tutoiement, hardcoded production URL |
| AUTH_STEPUP_CODE (dormant) | ACTION REQUIRED | action label (confirmer un retrait / modifier vos informations bancaires / modifier l'e-mail), code block, « 10 minutes, une seule fois », ignore-if-not-you + check your account | any link (code only) |
| ACCOUNT_EMAIL_CHANGE_CODE (dormant) | ACTION REQUIRED | same code component, fixed action « modifier l'e-mail de votre compte » | |
| ACCOUNT_EMAIL_CHANGE_LINK (dormant) | ACTION REQUIRED | to the NEW address: button « Confirmer ma nouvelle adresse » + copyable URL; « 15 minutes, une seule fois »; « tant que vous ne cliquez pas, rien ne change » | |
| ACCOUNT_EMAIL_CHANGED_ALERT (dormant) | WARNING (security) | to the OLD address: new address masked `l***@e***`; « si ce n'est pas vous, contactez-nous immédiatement : contact@grubano.com » | naming the full new address |
| ACCOUNT_EMAIL_CHANGE_CONFIRM (dormant) | SUCCESS | to the NEW address: it is now the login address | |
| ACCOUNT_EMAIL_ALREADY_USED (dormant) | NEUTRAL (security) | someone tried to attach this address; nothing changed; sign in normally if it was you | who tried, any link to the requester |

## Components (from the approved contract — reuse, do not invent)
Document shell · header band · status band · primary button + copyable raw URL · code block · note/helper text · support block + footer. No order components in this family. Apply the CTA exactly as the contract specifies (founder reservation acknowledged: acceptable, polish deferred).

## Conditional states to design
Empty name (« Bonjour, ») · code present/absent · masked address lengths · long URLs (wrap) · RTL readiness · dark mode · images-off · plain text (codes and URLs on their own line).

## Subject / preheader pattern (recommendation target)
Auth subjects name the action, not the brand twice: « Réinitialisez votre mot de passe », « Votre mot de passe a été modifié », « Bienvenue sur Grubano », « Votre code de confirmation », « Confirmez votre nouvelle adresse e-mail », « Votre e-mail de connexion a été modifié ». Preheader = validity or next step in one sentence. ≤ 60 / ≤ 90 chars, no emoji.

## Acceptance
10 references on the contract · CURRENT/DORMANT labels · correct validities everywhere · welcome truthful to the beta · every security email names the support channel · formal French · AA contrast · plain-text and images-off views · `E1-B-SYSTEM-FEEDBACK.md` lists only real system problems (or is empty).
