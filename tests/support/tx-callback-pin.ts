// tests/support/tx-callback-pin.ts — AST pin of the C6 / C8 Serializable transactions (J-M23, J-M25).
//
// Binding rule 6: the callback contains only the identity read and the write, referenced through tx; no singleton
// client, Stripe, closure record, audit, alert or e-mail inside it; the options are Serializable with a short wait and
// timeout. The pin reads the SHIPPED source with the TypeScript parser, so a comment or a string cannot satisfy it.
import ts from 'typescript'

export type TxPin = {
  fn: string
  /** `model.method` of every call made through the callback's client parameter, in source order. */
  calls: string[]
  options: { isolationLevel: string | null; maxWait: number | null; timeout: number | null }
  violations: string[]
}

const FORBIDDEN = new Set([
  'prisma', 'db', 'client', 'getStripe', 'stripe', 'recordClaimClosure', 'recordAdminAudit', 'sendAdminMoneyReviewAlert',
  'alertClaimPaymentBlocked', 'executeRefund', 'enterFinancialVerification', 'sendClaimClosureEmail',
])

/** Every $transaction call inside the top-level function `fnName` of `src`. */
export function txCallbackPins(src: string, fnName: string): TxPin[] {
  const sf = ts.createSourceFile('source.ts', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const out: TxPin[] = []
  for (const stmt of sf.statements) {
    if (!ts.isFunctionDeclaration(stmt) || stmt.name?.text !== fnName || !stmt.body) continue
    const walk = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === '$transaction') {
        const [cb, opts] = n.arguments
        const pin: TxPin = { fn: fnName, calls: [], options: { isolationLevel: null, maxWait: null, timeout: null }, violations: [] }
        if (!cb || !(ts.isArrowFunction(cb) || ts.isFunctionExpression(cb))) {
          pin.violations.push('the callback is not an inline function')
        } else {
          const param = cb.parameters[0]?.name.getText(sf) ?? ''
          if (param !== 'tx') pin.violations.push(`the callback parameter is « ${param} », not tx`)
          const inner = (m: ts.Node): void => {
            if (ts.isIdentifier(m) && (FORBIDDEN.has(m.text) || /^send[A-Z]/.test(m.text))) {
              const isPropertyName = ts.isPropertyAccessExpression(m.parent) && m.parent.name === m
              if (!isPropertyName) pin.violations.push(`references ${m.text}`)
            }
            if (ts.isCallExpression(m) && ts.isPropertyAccessExpression(m.expression) && ts.isPropertyAccessExpression(m.expression.expression)) {
              const root = m.expression.expression.expression.getText(sf)
              const call = `${m.expression.expression.name.text}.${m.expression.name.text}`
              if (root === 'tx') pin.calls.push(call)
              else pin.violations.push(`${root}.${call} is not made through tx`)
            }
            ts.forEachChild(m, inner)
          }
          inner(cb.body)
        }
        if (opts && ts.isObjectLiteralExpression(opts)) {
          for (const p of opts.properties) {
            if (!ts.isPropertyAssignment(p)) continue
            const k = p.name.getText(sf)
            if (k === 'isolationLevel') pin.options.isolationLevel = p.initializer.getText(sf)
            if (k === 'maxWait' && ts.isNumericLiteral(p.initializer)) pin.options.maxWait = Number(p.initializer.text)
            if (k === 'timeout' && ts.isNumericLiteral(p.initializer)) pin.options.timeout = Number(p.initializer.text)
          }
        } else {
          pin.violations.push('the options are not an inline object')
        }
        out.push(pin)
      }
      ts.forEachChild(n, walk)
    }
    walk(stmt.body)
  }
  return out
}
