// tests/support/race-stubs/admin-alerts.ts — the admin alert sender, silenced for the D′ L5 database rehearsal.
//
// The rehearsal exercises the blocked paths of the rail on purpose, and every one of them raises an alert. A
// rehearsal must never send an e-mail, so the sender is replaced at bundle time and answers « skipped ». The
// alerts themselves are proven by the in-memory tests, which assert their content; here only exclusion matters.
export async function sendAdminMoneyReviewAlert(): Promise<{ status: 'skipped' }> {
  return { status: 'skipped' }
}
