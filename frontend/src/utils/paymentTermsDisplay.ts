/** MYOB AccountRight SellingDetails.Terms.PaymentIsDue values (API / DB: payment_is_due). */
export const PAYMENT_IS_DUE_OPTIONS = [
  'CashOnDelivery',
  'PrePaid',
  'InAGivenNumberOfDays',
  'OnADayOfTheMonth',
  'NumberOfDaysAfterEOM',
  'DayOfMonthAfterEOM',
] as const

/** User-facing option labels (MYOB credit terms wording). */
export const PAYMENT_IS_DUE_LABELS: Record<string, string> = {
  CashOnDelivery: 'COD (cash on delivery)',
  PrePaid: 'Prepaid',
  InAGivenNumberOfDays: 'In a given number of days',
  OnADayOfTheMonth: 'On a day of the month',
  NumberOfDaysAfterEOM: '# of days after EOM (end of month)',
  DayOfMonthAfterEOM: 'Day of month after EOM (end of month)',
}

function coerceInt(v: unknown): number | null {
  if (v == null || v === '') return null
  if (typeof v === 'boolean') return null
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v)
  if (typeof v === 'string') {
    const s = v.trim()
    if (!s) return null
    const n = Number(s)
    return Number.isFinite(n) ? Math.trunc(n) : null
  }
  return null
}

function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`
  const s = { 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>
  return `${n}${s[n % 10] ?? 'th'}`
}

/** Summary line for stored payment_terms JSON (aligned with MYOB credit terms help). */
export function describePaymentTerms(terms: Record<string, unknown> | string | null | undefined): string | null {
  if (terms == null) return null
  if (typeof terms === 'string') {
    const s = terms.trim()
    return s ? s : null
  }
  if (typeof terms !== 'object' || Array.isArray(terms)) return null
  const pid = typeof terms.payment_is_due === 'string' ? terms.payment_is_due.trim() : ''
  if (!pid) return null
  const bal = coerceInt(terms.balance_due_date)

  if (pid === 'CashOnDelivery') return 'COD (cash on delivery)'
  if (pid === 'PrePaid') return 'Prepaid'
  if (pid === 'InAGivenNumberOfDays') {
    if (bal != null && bal > 0) return `Payment due within ${bal} days of invoice.`
    return 'In a given number of days (set balance due days).'
  }
  if (pid === 'OnADayOfTheMonth') {
    if (bal != null && bal >= 1 && bal <= 31) return `Payment due on the ${ordinal(bal)} of the month.`
    return 'On a day of the month.'
  }
  if (pid === 'NumberOfDaysAfterEOM') {
    if (bal != null && bal > 0) return `${bal} days after end of month.`
    return '# of days after EOM (end of month) — set how many days after month-end.'
  }
  if (pid === 'DayOfMonthAfterEOM') {
    if (bal === 31) return 'Balance due on the last day of the month after end of month.'
    if (bal != null && bal >= 1 && bal <= 31) return `Balance due on the ${ordinal(bal)} after end of month.`
    return 'Day of month after EOM — set the balance due day (1–31; 31 = last day of month).'
  }
  return null
}

export type PaymentTermNumericLabels = {
  balanceLabel: string
  balanceHelper: string
  /** When false, hide the balance due field (e.g. COD / Prepaid). */
  showBalanceField: boolean
}

/** Field labels / hints for balance due (MYOB BalanceDueDate; semantics depend on PaymentIsDue). */
export function paymentTermNumericLabels(paymentIsDue: string): PaymentTermNumericLabels {
  const due = (paymentIsDue || '').trim()
  switch (due) {
    case 'CashOnDelivery':
    case 'PrePaid':
      return {
        balanceLabel: 'Balance due',
        balanceHelper: 'Not used for COD / Prepaid.',
        showBalanceField: false,
      }
    case 'InAGivenNumberOfDays':
      return {
        balanceLabel: 'Balance due days',
        balanceHelper: 'Payment is due this many days after invoice.',
        showBalanceField: true,
      }
    case 'OnADayOfTheMonth':
      return {
        balanceLabel: 'Payment due day of month',
        balanceHelper: 'Day of the month (1–31) when payment is due.',
        showBalanceField: true,
      }
    case 'NumberOfDaysAfterEOM':
      return {
        balanceLabel: 'Days after end of month',
        balanceHelper: 'Number of days after the current month-end when payment is due.',
        showBalanceField: true,
      }
    case 'DayOfMonthAfterEOM':
      return {
        balanceLabel: 'Balance due day of month (after EOM)',
        balanceHelper: 'Use 31 for last day of month (MYOB BalanceDueDate).',
        showBalanceField: true,
      }
    default:
      return {
        balanceLabel: 'Balance due date',
        balanceHelper: 'Meaning depends on the selected payment type.',
        showBalanceField: true,
      }
  }
}
