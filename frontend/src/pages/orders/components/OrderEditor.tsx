import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProductListItem } from '../../../store/slices/productsSlice'
import { useLocation, useNavigate } from 'react-router-dom'
import { useUnsavedChanges } from '../../../contexts/UnsavedChangesContext'
import { useAppDispatch, useAppSelector } from '../../../store/hooks'
import { can } from '../../../auth/permissions'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { CustomerSearchAutocomplete } from '../../../components/CustomerSearchAutocomplete'
import { ProductSearchAutocomplete } from '../../../components/ProductSearchAutocomplete'
import { buildOrderLineDefaultsFromProduct } from '../../../utils/orderLineDefaults'
import { OrderFormFooter } from './OrderFormFooter'
import {
  EMBEDDED_NEW_JOB_SHEET_PRODUCT_ID,
  type EmbeddedNewJobSheetFlow,
  type OrderLineQtySnapshot,
  ProductVersionEditor,
} from '../../products/components/ProductVersionEditor'
import { fetchProducts } from '../../../store/slices/productsSlice'
import {
  addOrderItem,
  addOrderResellItem,
  convertResellLineToMyobJobSheet,
  createOrder,
  deleteOrderItem,
  deleteOrderResellItem,
  fetchOrder,
  fetchOrdersBootstrap,
  linkMyobImportLine,
  patchOrder,
  patchOrderResellItem,
} from '../../../store/slices/ordersSlice'
import { updateJobSheet } from '../../../store/slices/jobSheetsSlice'

type Mode = 'new' | 'edit'

type Product = ProductListItem
type QuantityUnit = 'kg' | 'rolls' | 'cartons' | '1000' | 'ea' | 'meters'

type ResellCatalogKind = 'supply' | 'outsourced_manufacturing'

type MyobImportLineRow = {
  id: string
  line_index: number
  description: string
  ship_quantity: number
  quantity_unit: string
  qty_type: string
  unit_price: number | null
  line_total: number | null
  myob_item_number?: string | null
  myob_item_name?: string | null
  myob_item_sales_unit_raw?: string | null
  requires_job_sheet: boolean
  job_sheet_id?: string | null
  linked_product_id?: string | null
  job_no?: string | null
  is_import_draft?: boolean
}

type OrderLine = {
  id: string // react key
  line_kind?: 'product' | 'resell'
  product_id: string
  product_code: string
  product_name?: string | null
  due_date: string
  quantity_unit: QuantityUnit
  quantity_value: string
  rate: string
  total_price: string
  /** From product spec (list or order item); drives which units are offered. */
  finish_mode?: 'Rolls' | 'Cartons' | null
  // edit-mode only
  order_item_id?: string
  job_sheet_id?: string
  resell_line_id?: string
  resell_product_id?: string
  /** From linked resell catalog row; drives quantity unit choices for outsourced MYOB lines. */
  resell_catalog_kind?: ResellCatalogKind
  /** Present when this resell row came from MYOB import (convert to manufactured / job sheet). */
  myob_item_uid?: string | null
  myob_row_id?: number | null
  import_line_description?: string | null
  is_import_draft?: boolean
  /** Display / merge order (matches server `line_index` when persisted). */
  line_index?: number
}

function normalizeFinishFromApi(v: unknown): 'Rolls' | 'Cartons' | null {
  if (v === 'Cartons') return 'Cartons'
  if (v === 'Rolls') return 'Rolls'
  return null
}

function normalizeQuantityUnitFromApi(
  raw: string | undefined,
  finish: 'Rolls' | 'Cartons' | null,
): QuantityUnit {
  const x = String(raw || 'kg').toLowerCase()
  if (x === 'ea' || x === 'each') return 'ea'
  if (x === 'rolls') return 'rolls'
  if (x === 'cartons') return 'cartons'
  if (x === '1000') return '1000'
  if (x === 'bags' && finish === 'Cartons') return 'cartons'
  return 'kg'
}

function jobSheetIdFromApi(raw: unknown): string {
  if (raw == null || raw === '') return ''
  const s = String(raw).trim()
  if (s === 'undefined' || s === 'null') return ''
  return s
}

function orderLinesFromApiItems(items: unknown): OrderLine[] {
  return (Array.isArray(items) ? items : [])
    .filter((x: any) => x && x.line_kind !== 'myob_import')
    .map((x: any, i: number) => {
      const line = lineFromApiItem(x)
      const li =
        x?.line_index != null && Number.isFinite(Number(x.line_index)) ? Number(x.line_index) : i
      return { ...line, line_index: li }
    })
}

function nextLineIndex(lines: OrderLine[]): number {
  let max = -1
  for (const l of lines) {
    if (l.line_index != null && l.line_index > max) max = l.line_index
  }
  return max + 1
}

function isUnpersistedLocalResellLine(l: OrderLine): boolean {
  return l.line_kind === 'resell' && !l.resell_line_id
}

function buildResellOrderItemBody(it: OrderLine) {
  const rate = parseOptionalMoney(it.rate)
  const totalPrice = computedLineTotal(it)
  return {
    resell_product_id: String(it.resell_product_id || ''),
    due_date: it.due_date || null,
    quantity_unit: it.quantity_unit,
    quantity_value: Number(it.quantity_value || '0'),
    ...(rate != null ? { rate } : {}),
    ...(totalPrice != null ? { total_price: totalPrice } : {}),
  }
}

function buildResellItemsPayloadFromLines(resellLines: OrderLine[]) {
  return resellLines.map((it) => buildResellOrderItemBody(it))
}

function sortOrderLinesByIndex(lines: OrderLine[]): OrderLine[] {
  return [...lines].sort((a, b) => {
    const ia = a.line_index ?? 0
    const ib = b.line_index ?? 0
    if (ia !== ib) return ia - ib
    return String(a.id).localeCompare(String(b.id))
  })
}

function findMatchingLocalOrderLine(apiLine: OrderLine, localLines: OrderLine[]): OrderLine | undefined {
  if (apiLine.order_item_id) {
    const byOrderItem = localLines.find(
      (l) => l.order_item_id && String(l.order_item_id) === String(apiLine.order_item_id),
    )
    if (byOrderItem) return byOrderItem
  }
  if (apiLine.line_kind === 'resell') {
    if (apiLine.resell_line_id) {
      return localLines.find(
        (l) => l.resell_line_id && String(l.resell_line_id) === String(apiLine.resell_line_id),
      )
    }
    return undefined
  }
  if (apiLine.job_sheet_id) {
    return localLines.find(
      (l) => l.job_sheet_id && String(l.job_sheet_id) === String(apiLine.job_sheet_id),
    )
  }
  return undefined
}

function applyPreservedFieldsFromLocal(
  apiLine: OrderLine,
  local: OrderLine,
  fields: { rate?: boolean; quantity?: boolean; dueDate?: boolean },
): OrderLine {
  return {
    ...apiLine,
    ...(fields.rate ? { rate: local.rate } : {}),
    ...(fields.quantity
      ? { quantity_value: local.quantity_value, quantity_unit: local.quantity_unit }
      : {}),
    ...(fields.dueDate ? { due_date: local.due_date } : {}),
  }
}

/**
 * Merge a fresh GET /orders/:id payload with local table state.
 * Handles multiple resell lines (including same catalog product) without dropping or duplicating rows.
 */
function reconcileOrderLinesWithLocal(
  apiLines: OrderLine[],
  localLines: OrderLine[],
  fields: { rate?: boolean; quantity?: boolean; dueDate?: boolean },
): OrderLine[] {
  if (!localLines.length) return apiLines

  const localUnpersistedResell = localLines.filter(isUnpersistedLocalResellLine)
  const apiResell = apiLines.filter((l) => l.line_kind === 'resell')
  const nonResellApi = apiLines.filter((l) => l.line_kind !== 'resell')

  const mergedNonResell = nonResellApi.map((apiLine) => {
    const local = findMatchingLocalOrderLine(apiLine, localLines)
    return local ? applyPreservedFieldsFromLocal(apiLine, local, fields) : apiLine
  })

  const pool = [...localUnpersistedResell]
  const mergedResell = apiResell.map((apiLine) => {
    const idx = pool.findIndex((l) => String(l.resell_product_id) === String(apiLine.resell_product_id))
    if (idx < 0) {
      const local = findMatchingLocalOrderLine(apiLine, localLines)
      return local ? applyPreservedFieldsFromLocal(apiLine, local, fields) : apiLine
    }
    const local = pool.splice(idx, 1)[0]
    return applyPreservedFieldsFromLocal(apiLine, local, fields)
  })

  let next = nextLineIndex([...mergedNonResell, ...mergedResell])
  for (const l of pool) {
    mergedResell.push({ ...l, line_index: next++ })
  }

  return sortOrderLinesByIndex([...mergedNonResell, ...mergedResell])
}

function lineFromApiItem(it: any): OrderLine {
  if (it.line_kind === 'resell') {
    const rowIdRaw = it.myob_row_id
    const rowId =
      rowIdRaw != null && rowIdRaw !== '' && Number.isFinite(Number(rowIdRaw)) ? Number(rowIdRaw) : null
    return {
      id: String(it.id),
      line_kind: 'resell',
      order_item_id: String(it.id),
      resell_line_id: String(it.resell_line_id || it.id),
      resell_product_id: String(it.resell_product_id || ''),
      resell_catalog_kind:
        it.resell_catalog_kind === 'outsourced_manufacturing' ? 'outsourced_manufacturing' : 'supply',
      myob_item_uid: it.myob_item_uid != null ? String(it.myob_item_uid) : null,
      myob_row_id: rowId,
      job_sheet_id: '',
      product_id: String(it.resell_product_id || it.product_id || ''),
      product_code: String(it.product_code || 'Resell'),
      product_name: (it.product_name as string | null | undefined) ?? null,
      due_date: String(it.due_date || ''),
      finish_mode: null,
      quantity_unit: normalizeQuantityUnitFromApi(it.quantity_unit as string | undefined, null),
      quantity_value: it.quantity_value != null ? String(it.quantity_value) : '1',
      rate: it.rate != null && Number.isFinite(Number(it.rate)) ? String(it.rate) : '',
      total_price: it.total_price != null && Number.isFinite(Number(it.total_price)) ? String(it.total_price) : '',
    }
  }
  let finish = normalizeFinishFromApi(it.finish_mode)
  const rawU = String(it.quantity_unit || '').toLowerCase()
  if (!finish && rawU === 'cartons') finish = 'Cartons'
  if (!finish && rawU === 'rolls') finish = 'Rolls'
  return {
    id: String(it.id),
    line_kind: 'product',
    order_item_id: String(it.id),
    job_sheet_id: jobSheetIdFromApi(it.job_sheet_id ?? (it as { jobSheetId?: unknown }).jobSheetId),
    product_id: String(it.product_id),
    product_code: String(it.product_code || ''),
    product_name: (it.product_name as string | null | undefined) ?? null,
    import_line_description: (it.import_line_description as string | null | undefined) ?? null,
    is_import_draft: Boolean(it.is_import_draft),
    due_date: String(it.due_date || ''),
    finish_mode: finish,
    quantity_unit: normalizeQuantityUnitFromApi(it.quantity_unit as string | undefined, finish),
    quantity_value: it.quantity_value != null ? String(it.quantity_value) : '1',
    rate: it.rate != null && Number.isFinite(Number(it.rate)) ? String(it.rate) : '',
    total_price: it.total_price != null && Number.isFinite(Number(it.total_price)) ? String(it.total_price) : '',
  }
}

function finishModeForProduct(p: Product): 'Rolls' | 'Cartons' | null {
  const fm = p.finish_mode
  if (fm === 'Cartons') return 'Cartons'
  if (fm === 'Rolls') return 'Rolls'
  return null
}

/** When finish is unknown, treat as Rolls so we do not offer Carton until spec is known. */
function unitChoices(
  finish: 'Rolls' | 'Cartons' | null | undefined,
  lineKind?: 'product' | 'resell',
  resellCatalogKind?: ResellCatalogKind,
): QuantityUnit[] {
  if (lineKind === 'resell') {
    if (resellCatalogKind === 'outsourced_manufacturing') {
      return ['kg', 'rolls', 'cartons', '1000', 'meters', 'ea']
    }
    return ['ea']
  }
  const f = finish === 'Cartons' ? 'Cartons' : 'Rolls'
  if (f === 'Cartons') return ['kg', 'cartons', '1000']
  return ['kg', 'rolls', '1000']
}

function qtyTypeForSavedJobSheet(unit: QuantityUnit): string | undefined {
  if (unit === '1000') return 'units'
  if (unit === 'rolls') return 'total_rolls'
  if (unit === 'cartons') return 'units'
  if (unit === 'kg') return 'kg'
  return undefined
}

function buildProductOrderItemBody(
  productId: string,
  lineDefaults: { quantity_unit: QuantityUnit; quantity_value: string; rate: string },
) {
  const qv = Number(lineDefaults.quantity_value || '1')
  const qt = qtyTypeForSavedJobSheet(lineDefaults.quantity_unit)
  const rate = parseOptionalMoney(lineDefaults.rate)
  return {
    product_id: productId,
    due_date: defaultDueDate(),
    quantity_unit: lineDefaults.quantity_unit,
    quantity_value: qv,
    ...(rate != null ? { rate } : {}),
    ...(qt ? { qty_type: qt } : {}),
    ...(lineDefaults.quantity_unit === '1000' ? { num_product_units: Math.round(qv * 1000) } : {}),
  }
}

function buildProductOrderItemBodyFromLine(it: OrderLine) {
  const qv = Number(it.quantity_value || '0')
  const qt = qtyTypeForSavedJobSheet(it.quantity_unit)
  const rate = parseOptionalMoney(it.rate)
  const totalPrice = computedLineTotal(it)
  return {
    product_id: it.product_id,
    due_date: it.due_date || null,
    quantity_unit: it.quantity_unit,
    quantity_value: qv,
    ...(rate != null ? { rate } : {}),
    ...(totalPrice != null ? { total_price: totalPrice } : {}),
    ...(qt ? { qty_type: qt } : {}),
    ...(it.quantity_unit === '1000' ? { num_product_units: Math.round(qv * 1000) } : {}),
  }
}

/** Default due date: 4 weeks from today (YYYY-MM-DD). */
function defaultDueDate(): string {
  const d = new Date()
  d.setDate(d.getDate() + 28)
  return d.toISOString().slice(0, 10)
}

/** Computed line total = quantity × rate. */
function computedLineTotal(it: OrderLine): number | null {
  const q = Number(it.quantity_value)
  const r = parseOptionalMoney(it.rate)
  if (!Number.isFinite(q) || q < 0 || r == null || r < 0) return null
  return q * r
}

function parseOptionalMoney(s: string): number | null {
  const t = (s || '').trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : null
}

function isValidMoneyField(s: string): boolean {
  const t = (s || '').trim()
  if (t === '') return true
  const n = Number(t)
  return Number.isFinite(n) && n >= 0
}

function buildJobSheetUpdateBodyFromLine(it: OrderLine) {
  const qv = Number(it.quantity_value || '0')
  const qt = qtyTypeForSavedJobSheet(it.quantity_unit)
  return {
    due_date: it.due_date || null,
    quantity_value: qv,
    quantity_unit: it.quantity_unit,
    ...(qt ? { qty_type: qt } : {}),
    ...(it.quantity_unit === '1000' ? { num_product_units: Math.round(qv * 1000) } : {}),
    unit_rate: parseOptionalMoney(it.rate),
    line_total: computedLineTotal(it),
  }
}

type OrderNewDraft = {
  customerId: string
  items: OrderLine[]
}

function parseOrderNewDraftState(state: unknown): OrderNewDraft | null {
  const draft = (state as any)?.orderNewDraft
  if (!draft || typeof draft !== 'object') return null
  return {
    customerId: typeof (draft as any)?.customerId === 'string' ? (draft as any).customerId : '',
    items: Array.isArray((draft as any)?.items) ? ((draft as any).items as OrderLine[]) : [],
  }
}

function myobLinesFromApi(res: { items?: unknown; myob_import_lines?: unknown } | null | undefined): MyobImportLineRow[] {
  const fromOrderItems = (Array.isArray(res?.items) ? res.items : []).filter(
    (x: any) => x && x.line_kind === 'myob_import',
  ) as any[]
  const raw = fromOrderItems.length > 0 ? fromOrderItems : Array.isArray(res?.myob_import_lines) ? res?.myob_import_lines : []
  if (!Array.isArray(raw) || raw.length === 0) return []
  return raw.map((m: any) => ({
    id: String(m.id),
    line_index: Number(m.line_index) || 0,
    description: String(m.description ?? ''),
    ship_quantity: Number(m.ship_quantity ?? m.quantity_value) || 0,
    quantity_unit: String(m.quantity_unit ?? ''),
    qty_type: String(m.qty_type ?? ''),
    unit_price: m.unit_price != null && Number.isFinite(Number(m.unit_price)) ? Number(m.unit_price) : null,
    line_total: m.line_total != null && Number.isFinite(Number(m.line_total)) ? Number(m.line_total) : null,
    myob_item_number: m.myob_item_number != null ? String(m.myob_item_number) : null,
    myob_item_name: m.myob_item_name != null ? String(m.myob_item_name) : null,
    myob_item_sales_unit_raw: m.myob_item_sales_unit_raw != null ? String(m.myob_item_sales_unit_raw) : null,
    requires_job_sheet: Boolean(m.requires_job_sheet),
    job_sheet_id: m.job_sheet_id != null ? String(m.job_sheet_id) : null,
    linked_product_id: m.linked_product_id != null ? String(m.linked_product_id) : null,
    job_no: m.job_no != null ? String(m.job_no) : null,
    is_import_draft: Boolean(m.is_import_draft),
  }))
}

function resellLineHasMyobIdentifiers(it: OrderLine): boolean {
  if (it.line_kind !== 'resell') return false
  if (String(it.myob_item_uid || '').trim()) return true
  return it.myob_row_id != null && Number.isFinite(Number(it.myob_row_id))
}

export function OrderEditor(props: { mode: Mode; orderId?: string }) {
  const { mode, orderId } = props
  const nav = useNavigate()
  const loc = useLocation()
  const dispatch = useAppDispatch()
  const roles = useAppSelector((s) => s.auth.identity?.roles || [])
  const canEditProduct = can(roles, 'PROD_MANAGER')
  const canPublish = can(roles, 'SALES', 'PROD_MANAGER')
  const productList = useAppSelector((s) => s.products.list)
  const ordersBootstrap = useAppSelector((s) => s.orders.bootstrap)
  const { setDirty } = useUnsavedChanges()

  const [err, setErr] = useState<string | null>(null)
  const [customerDisplayName, setCustomerDisplayName] = useState<string | null>(null)

  const [saving, setSaving] = useState(false)
  const [orderStatus, setOrderStatus] = useState<string>(mode === 'new' ? 'draft' : '')
  const [orderLoaded, setOrderLoaded] = useState(mode === 'new')

  const [pvOpen, setPvOpen] = useState(false)
  const [pvProductId, setPvProductId] = useState<string | null>(null)
  const [pvJobSheetId, setPvJobSheetId] = useState<string | null>(null)
  const [pvTitle, setPvTitle] = useState<string>('')
  const [pvOrderLineQty, setPvOrderLineQty] = useState<OrderLineQtySnapshot | null>(null)

  const [newJobSheetOpen, setNewJobSheetOpen] = useState(false)

  const initialDraftRef = useRef<OrderNewDraft | null>(mode === 'new' ? parseOrderNewDraftState(loc.state) : null)
  const initialDraft = initialDraftRef.current

  const [customerId, setCustomerId] = useState(initialDraft?.customerId || '')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [customerPoNumber, setCustomerPoNumber] = useState('')
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [items, setItems] = useState<OrderLine[]>(() =>
    (initialDraft?.items || []).map((it, i) => ({
      ...it,
      rate: (it as OrderLine).rate ?? '',
      total_price: (it as OrderLine).total_price ?? '',
      line_index: (it as OrderLine).line_index ?? i,
    }))
  )
  const [myobImportLines, setMyobImportLines] = useState<MyobImportLineRow[]>([])
  const [linkMyobOpen, setLinkMyobOpen] = useState(false)
  const [linkMyobLine, setLinkMyobLine] = useState<MyobImportLineRow | null>(null)
  const [linkMyobJobSheetId, setLinkMyobJobSheetId] = useState('')
  const [linkMyobSubmitting, setLinkMyobSubmitting] = useState(false)
  const [convertingResellLineId, setConvertingResellLineId] = useState<string | null>(null)
  const [importSource, setImportSource] = useState<string | null>(null)
  const [importReviewStatus, setImportReviewStatus] = useState<'incomplete' | 'complete' | null>(null)
  /** New-order screen: server draft created when the first manufactured line is added (before “Save draft”). */
  const [draftOrderId, setDraftOrderId] = useState<string | null>(null)
  const effectiveOrderId = orderId || draftOrderId

  /** Order lines and header fields stay editable for all lifecycle statuses. */
  const orderLocked = false

  const originalRef = useRef<{ lines: Record<string, OrderLine> } | null>(null)

  const newJobSheetEmbeddedFlow = useMemo((): EmbeddedNewJobSheetFlow | null => {
    if (!newJobSheetOpen || !String(customerId || '').trim()) return null
    return {
      customerId,
      orderMode: mode,
      orderId: effectiveOrderId ?? null,
      initialOrderDate: orderDate,
      initialCustomerPurchaseOrderNumber: customerPoNumber,
      onCancel: () => setNewJobSheetOpen(false),
      onFinished: () => {
        setNewJobSheetOpen(false)
        void dispatch(fetchProducts({ customer_id: customerId }))
        if (effectiveOrderId) {
          void (async () => {
            try {
              const { order: res } = await dispatch(fetchOrder(effectiveOrderId)).unwrap()
              setOrderStatus(String(res?.status || 'draft'))
              setInvoiceNumber(String(res?.code ?? ''))
              setCustomerPoNumber(String(res?.customer_purchase_order_number ?? ''))
              setOrderDate(res?.order_date ? String(res.order_date).slice(0, 10) : '')
              const nextItems: OrderLine[] = sortOrderLinesByIndex(orderLinesFromApiItems(res?.items))
              setItems(nextItems)
              setMyobImportLines(myobLinesFromApi(res))
              originalRef.current = { lines: Object.fromEntries(nextItems.map((l) => [l.id, { ...l }])) }
            } catch {
              /* ignore */
            }
          })()
        }
      },
      onNewDraftLine:
        mode === 'new'
          ? (args) => {
              setItems((prev) => [
                ...prev,
                {
                  id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
                  line_kind: 'product',
                  product_id: args.product_id,
                  product_code: args.product_code,
                  product_name: args.product_name ?? null,
                  due_date: args.due_date,
                  finish_mode: args.finish_mode,
                  quantity_unit: args.quantity_unit,
                  quantity_value: String(args.quantity_value),
                  rate: '',
                  total_price: '',
                  line_index: nextLineIndex(prev),
                },
              ])
            }
          : undefined,
    }
  }, [newJobSheetOpen, customerId, mode, effectiveOrderId, orderDate, customerPoNumber, dispatch])

  const prevCustomerId = useRef<string>(initialDraft?.customerId || '')

  /** One-shot: open embedded job sheet dialog after quote → order (see `openJobSheetFor` in location state). */
  const convertJobSheetModalHandledRef = useRef(false)

  const resellCatalog = ordersBootstrap.resell_products || []
  const bootstrapErr = ordersBootstrap.status === 'failed' ? ordersBootstrap.error : null
  const productListErr =
    customerId && productList.lastCustomerId === customerId && productList.status === 'failed' ? productList.error : null

  function applyOrderResponse(
    res: { status?: string; code?: string; customer_purchase_order_number?: string | null; order_date?: string | null; items?: unknown },
    opts?: { preserveLocalLines?: OrderLine[]; preserveFields?: { rate?: boolean; quantity?: boolean; dueDate?: boolean } },
  ) {
    setOrderStatus(String(res?.status || 'draft'))
    setInvoiceNumber(String(res?.code ?? ''))
    setCustomerPoNumber(String(res?.customer_purchase_order_number ?? ''))
    setOrderDate(res?.order_date ? String(res.order_date).slice(0, 10) : '')
    let nextItems: OrderLine[] = orderLinesFromApiItems(res?.items)
    if (opts?.preserveLocalLines?.length) {
      nextItems = reconcileOrderLinesWithLocal(
        nextItems,
        opts.preserveLocalLines,
        opts.preserveFields ?? { rate: true, quantity: true, dueDate: true },
      )
    }
    setItems(sortOrderLinesByIndex(nextItems))
    setMyobImportLines(myobLinesFromApi(res))
    originalRef.current = { lines: Object.fromEntries(nextItems.map((l) => [l.id, { ...l }])) }
  }

  /** Persist table edits to job sheets before a fetch would overwrite local qty/rate state. */
  async function persistManufacturedLineEdits(lines: OrderLine[]) {
    for (const it of lines) {
      if (it.line_kind === 'resell' || !it.job_sheet_id) continue
      await dispatch(
        updateJobSheet({
          jobSheetId: it.job_sheet_id,
          body: buildJobSheetUpdateBodyFromLine(it),
        }),
      ).unwrap()
    }
  }

  async function persistResellLineEdits(oid: string, lines: OrderLine[]) {
    for (const it of lines) {
      if (it.line_kind !== 'resell') continue
      const rid = it.resell_line_id || it.order_item_id
      if (!rid) continue
      await dispatch(
        patchOrderResellItem({
          orderId: oid,
          lineId: rid,
          body: {
            quantity_value: Number(it.quantity_value || '0'),
            quantity_unit: it.quantity_unit,
            due_date: it.due_date || null,
            rate: parseOptionalMoney(it.rate),
            total_price: computedLineTotal(it),
          },
        }),
      ).unwrap()
    }
  }

  async function persistUnpersistedResellLines(oid: string, lines: OrderLine[]) {
    for (const it of lines) {
      if (!isUnpersistedLocalResellLine(it)) continue
      await dispatch(
        addOrderResellItem({
          orderId: oid,
          body: buildResellOrderItemBody(it),
        }),
      ).unwrap()
    }
  }

  async function persistAllOrderLineEdits(oid: string, lines: OrderLine[]) {
    await persistUnpersistedResellLines(oid, lines)
    await persistManufacturedLineEdits(lines)
    await persistResellLineEdits(oid, lines)
  }

  async function ensureDraftOrderFromLocalLines(): Promise<string | null> {
    if (orderId) return orderId
    if (draftOrderId) return draftOrderId
    const productLines = items.filter((it) => it.line_kind !== 'resell')
    if (!String(customerId || '').trim() || productLines.length === 0) return null
    setErr(null)
    setSaving(true)
    try {
      const resellLines = items.filter((it) => it.line_kind === 'resell')
      const res = await dispatch(
        createOrder({
          customer_id: customerId,
          status: 'draft',
          ...(invoiceNumber.trim() ? { invoice_number: invoiceNumber.trim() } : {}),
          ...(customerPoNumber.trim() ? { customer_purchase_order_number: customerPoNumber.trim() } : {}),
          ...(orderDate ? { order_date: orderDate } : {}),
          items: productLines.map((it) => buildProductOrderItemBodyFromLine(it)),
          ...(resellLines.length ? { resell_items: buildResellItemsPayloadFromLines(resellLines) } : {}),
        }),
      ).unwrap()
      const oid = String(res.order_id)
      setDraftOrderId(oid)
      const { order: full } = await dispatch(fetchOrder(oid)).unwrap()
      applyOrderResponse(full)
      return oid
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create order draft')
      return null
    } finally {
      setSaving(false)
    }
  }

  function openProductVersionModal(p: {
    product_id: string
    product_code?: string | null
    job_sheet_id?: string | null
    /** Table row values when opening from an order line (unsaved qty/due date must match the modal). */
    orderLineQty?: OrderLineQtySnapshot | null
  }) {
    setPvProductId(p.product_id)
    const js = jobSheetIdFromApi(p.job_sheet_id)
    setPvJobSheetId(js || null)
    setPvOrderLineQty(p.orderLineQty ?? null)
    setPvTitle(
      js
        ? p.product_code
          ? `Edit job sheet — ${p.product_code}`
          : 'Edit job sheet'
        : p.product_code
          ? `Edit ${p.product_code}`
          : 'Edit product',
    )
    setPvOpen(true)
  }

  /** Resolve job sheet id for persisted orders if local line state is missing it (enables quantity + spec modal). */
  async function openProductVersionModalForLine(it: OrderLine) {
    const oid = effectiveOrderId
    if (oid && it.line_kind !== 'resell' && it.job_sheet_id) {
      try {
        await persistManufacturedLineEdits([it])
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to save line before opening job sheet')
        return
      }
    }
    let js = jobSheetIdFromApi(it.job_sheet_id)
    if (!js && oid) {
      try {
        const { order: res } = await dispatch(fetchOrder(oid)).unwrap()
        const row = (res?.items || []).find((x: { id?: unknown; product_id?: unknown }) => {
          if (it.order_item_id && String(x.id) === String(it.order_item_id)) return true
          return String(x.product_id) === String(it.product_id)
        })
        js = jobSheetIdFromApi(row?.job_sheet_id ?? (row as { jobSheetId?: unknown } | undefined)?.jobSheetId)
        if (js) {
          setItems((prev) => prev.map((l) => (l.id === it.id ? { ...l, job_sheet_id: js, order_item_id: String(row?.id || l.order_item_id || '') } : l)))
        }
      } catch {
        /* keep js empty */
      }
    }
    if (mode === 'new' && !js) {
      const created = await ensureDraftOrderFromLocalLines()
      if (created) {
        try {
          const { order: res } = await dispatch(fetchOrder(created)).unwrap()
          const row = (res?.items || []).find((x: { product_id?: unknown }) => String(x.product_id) === String(it.product_id))
          js = jobSheetIdFromApi(row?.job_sheet_id ?? (row as { jobSheetId?: unknown } | undefined)?.jobSheetId)
          if (js) {
            setItems((prev) =>
              prev.map((l) =>
                l.product_id === it.product_id
                  ? { ...l, job_sheet_id: js, order_item_id: String((row as { id?: unknown })?.id || l.order_item_id || '') }
                  : l,
              ),
            )
          }
        } catch {
          /* keep js empty */
        }
      }
    }
    openProductVersionModal({
      product_id: it.product_id,
      product_code: it.product_code,
      job_sheet_id: js || null,
      orderLineQty: {
        quantity_value: it.quantity_value,
        quantity_unit: it.quantity_unit,
        due_date: it.due_date,
      },
    })
  }

  function closeProductVersionModal() {
    setPvOpen(false)
    setPvProductId(null)
    setPvJobSheetId(null)
    setPvOrderLineQty(null)
    setPvTitle('')
  }

  useEffect(() => {
    const cid = String(customerId || '').trim()
    void dispatch(fetchOrdersBootstrap(cid ? { customer_id: cid } : undefined))
  }, [dispatch, customerId])

  useEffect(() => {
    if (mode !== 'new') return
    // Allow deep-linking into "New Order for customer X" from Customers page.
    const qs = new URLSearchParams(loc.search)
    const pre = qs.get('customerId') || qs.get('customer_id')
    if (!pre) return
    if (pre === customerId && items.length > 0) return
    setCustomerId(pre)
    setItems([])
    setErr(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  useEffect(() => {
    if (mode !== 'edit') return
    if (!orderId) return
    setOrderLoaded(false)
    void (async () => {
      try {
        setErr(null)
        const { order: res } = await dispatch(fetchOrder(orderId)).unwrap()
        setOrderStatus(String(res?.status || ''))
        setCustomerId(String(res?.customer_id || ''))
        setCustomerDisplayName(res?.customer_name ? String(res.customer_name) : null)
        setInvoiceNumber(String(res?.code ?? ''))
        setCustomerPoNumber(String(res?.customer_purchase_order_number ?? ''))
        setOrderDate(res?.order_date ? String(res.order_date).slice(0, 10) : '')
        setImportSource(res?.import_source != null && String(res.import_source).trim() ? String(res.import_source) : null)
        const irs = res?.import_review_status
        setImportReviewStatus(irs === 'complete' || irs === 'incomplete' ? irs : null)
        const nextItems: OrderLine[] = sortOrderLinesByIndex(orderLinesFromApiItems(res?.items))
        setItems(nextItems)
        setMyobImportLines(myobLinesFromApi(res))
        originalRef.current = {
          lines: Object.fromEntries(nextItems.map((l) => [l.id, { ...l }])),
        }
        setOrderLoaded(true)
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to load order')
        setOrderLoaded(true)
      }
    })()
  }, [mode, orderId, dispatch])

  useEffect(() => {
    convertJobSheetModalHandledRef.current = false
  }, [orderId])

  useEffect(() => {
    if (mode !== 'edit' || !orderId) return
    if (convertJobSheetModalHandledRef.current) return
    const st = loc.state as
      | { openJobSheetFor?: { job_sheet_id: string; product_id: string; product_code?: string | null } }
      | undefined
    const req = st?.openJobSheetFor
    if (!req?.job_sheet_id || !req.product_id) return
    if (!items.length) return

    const clearOpenFlag = () => {
      nav({ pathname: loc.pathname, search: loc.search, hash: loc.hash }, { replace: true, state: {} })
    }

    const line = items.find((it) => String(it.job_sheet_id) === String(req.job_sheet_id))
    convertJobSheetModalHandledRef.current = true

    if (!line) {
      clearOpenFlag()
      return
    }

    clearOpenFlag()

    if (!canEditProduct) return

    const code = (req.product_code != null && String(req.product_code).trim() !== ''
      ? String(req.product_code)
      : line.product_code) || ''
    openProductVersionModal({
      product_id: String(req.product_id),
      product_code: code || null,
      job_sheet_id: String(req.job_sheet_id),
      orderLineQty: {
        quantity_value: line.quantity_value,
        quantity_unit: line.quantity_unit,
        due_date: line.due_date,
      },
    })
  }, [mode, orderId, items, loc.state, loc.pathname, loc.search, loc.hash, canEditProduct, nav])

  useEffect(() => {
    if (!customerId) return
    void dispatch(fetchProducts({ customer_id: customerId }))
  }, [customerId, dispatch])

  useEffect(() => {
    if (!customerId || productList.lastCustomerId !== customerId) return
    const plist = productList.items as Product[]
    if (!plist.length) return
    setItems((prev) => {
      let changed = false
      const next = prev.map((l) => {
        if (l.line_kind === 'resell') return l
        if (l.finish_mode) return l
        const p = plist.find((x) => x.id === l.product_id)
        const fm = finishModeForProduct(p as Product)
        if (!fm) return l
        changed = true
        const allowed = unitChoices(fm)
        let qtyUnit = l.quantity_unit
        if (!allowed.includes(qtyUnit)) qtyUnit = allowed[0]
        return { ...l, finish_mode: fm, quantity_unit: qtyUnit }
      })
      return changed ? next : prev
    })
  }, [customerId, productList.items, productList.lastCustomerId])

  useEffect(() => {
    if (mode !== 'new') return
    // Reset dependent fields when customer changes (user-driven).
    if (prevCustomerId.current === customerId) return
    prevCustomerId.current = customerId
    setItems([])
    setDraftOrderId(null)
  }, [customerId, mode])

  async function addSelectedProductToNewOrder(p: Product) {
    if (!p?.id) return
    const pv = p.active_version_id || ''
    if (!pv) {
      setErr(`Product ${p.code} has no active version yet`)
      return
    }
    const lineDefaults = buildOrderLineDefaultsFromProduct(p)
    const body = buildProductOrderItemBody(p.id, lineDefaults)
    try {
      setErr(null)
      setSaving(true)
      const localResellLines = items.filter((it) => it.line_kind === 'resell')
      let oid = draftOrderId
      if (!oid) {
        const res = await dispatch(
          createOrder({
            customer_id: customerId,
            status: 'draft',
            ...(invoiceNumber.trim() ? { invoice_number: invoiceNumber.trim() } : {}),
            ...(customerPoNumber.trim() ? { customer_purchase_order_number: customerPoNumber.trim() } : {}),
            ...(orderDate ? { order_date: orderDate } : {}),
            items: [body],
            ...(localResellLines.length
              ? { resell_items: buildResellItemsPayloadFromLines(localResellLines) }
              : {}),
          }),
        ).unwrap()
        oid = String(res.order_id)
        setDraftOrderId(oid)
      } else {
        await persistManufacturedLineEdits(items)
        await dispatch(addOrderItem({ orderId: oid, body })).unwrap()
      }
      const localBeforeFetch = items
      const { order: full } = await dispatch(fetchOrder(oid)).unwrap()
      applyOrderResponse(full, { preserveLocalLines: localBeforeFetch })
      setDirty(true)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to add product line')
    } finally {
      setSaving(false)
    }
  }

  function addResellToItemsLocal(rp: { id: string; description: string; unit_price: number; catalog_kind?: string | null }) {
    const rate = Number.isFinite(rp.unit_price) ? String(rp.unit_price) : ''
    const rck: ResellCatalogKind =
      rp.catalog_kind === 'outsourced_manufacturing' ? 'outsourced_manufacturing' : 'supply'
    const defaultUnit = rck === 'outsourced_manufacturing' ? unitChoices(null, 'resell', rck)[0] : 'ea'
    setItems((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        line_kind: 'resell',
        resell_product_id: rp.id,
        resell_catalog_kind: rck,
        product_id: rp.id,
        product_code: 'Resell',
        product_name: rp.description,
        due_date: defaultDueDate(),
        finish_mode: null,
        quantity_unit: defaultUnit,
        quantity_value: '1',
        rate,
        total_price: '',
        line_index: nextLineIndex(prev),
      },
    ])
  }

  async function addResellToOrder(rp: { id: string; description: string; unit_price: number; catalog_kind?: string | null }) {
    if (!orderId) return
    try {
      setErr(null)
      setSaving(true)
      const rck: ResellCatalogKind =
        rp.catalog_kind === 'outsourced_manufacturing' ? 'outsourced_manufacturing' : 'supply'
      const defaultUnit = rck === 'outsourced_manufacturing' ? unitChoices(null, 'resell', rck)[0] : 'ea'
      await dispatch(
        addOrderResellItem({
          orderId,
          body: {
            resell_product_id: rp.id,
            quantity_value: 1,
            quantity_unit: defaultUnit,
            due_date: defaultDueDate(),
            rate: Number.isFinite(rp.unit_price) ? rp.unit_price : undefined,
          },
        }),
      ).unwrap()
      const { order: res } = await dispatch(fetchOrder(orderId)).unwrap()
      const nextItems: OrderLine[] = sortOrderLinesByIndex(orderLinesFromApiItems(res?.items))
      setItems(nextItems)
      setMyobImportLines(myobLinesFromApi(res))
      originalRef.current = { lines: Object.fromEntries(nextItems.map((l) => [l.id, l])) }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to add resell line')
    } finally {
      setSaving(false)
    }
  }

  async function addSelectedProductToOrder(p: Product) {
    if (!orderId) return
    if (!p?.id) return
    const pv = p.active_version_id || ''
    if (!pv) {
      setErr(`Product ${p.code} has no active version yet`)
      return
    }
    const lineDefaults = buildOrderLineDefaultsFromProduct(p)
    const qv = Number(lineDefaults.quantity_value || '1')
    const qt = qtyTypeForSavedJobSheet(lineDefaults.quantity_unit)
    const rate = parseOptionalMoney(lineDefaults.rate)
    const prevLineKeys = new Set(items.map((it) => it.order_item_id || it.id))
    try {
      setErr(null)
      setSaving(true)
      await persistManufacturedLineEdits(items)
      await dispatch(
        addOrderItem({
          orderId,
          body: {
            product_id: p.id,
            due_date: defaultDueDate(),
            quantity_unit: lineDefaults.quantity_unit,
            quantity_value: qv,
            ...(rate != null ? { rate } : {}),
            ...(qt ? { qty_type: qt } : {}),
            ...(lineDefaults.quantity_unit === '1000' ? { num_product_units: Math.round(qv * 1000) } : {}),
          },
        }),
      ).unwrap()
      // reload order to pick up job_sheet_id/order_item_id
      const { order: res } = await dispatch(fetchOrder(orderId)).unwrap()
      const nextItems: OrderLine[] = sortOrderLinesByIndex(orderLinesFromApiItems(res?.items))
      setItems(nextItems)
      setMyobImportLines(myobLinesFromApi(res))
      originalRef.current = { lines: Object.fromEntries(nextItems.map((l) => [l.id, l])) }

      const added = nextItems.filter((it) => !prevLineKeys.has(it.order_item_id || it.id))
      const newLine = added[0]
      if (newLine?.product_id && newLine.job_sheet_id && canEditProduct) {
        openProductVersionModal({
          product_id: newLine.product_id,
          product_code: newLine.product_code,
          job_sheet_id: newLine.job_sheet_id,
          orderLineQty: {
            quantity_value: newLine.quantity_value,
            quantity_unit: newLine.quantity_unit,
            due_date: newLine.due_date,
          },
        })
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to add order item')
    } finally {
      setSaving(false)
    }
  }

  const canSaveDraft = useMemo(() => {
    if (!customerId) return false
    if (saving) return false
    if (items.length === 0 && myobImportLines.length === 0) return false
    return items.every((it) => {
      const q = Number(it.quantity_value || '0')
      if (!Number.isFinite(q) || q <= 0 || !it.quantity_unit) return false
      if (it.line_kind === 'resell') {
        return !!it.resell_product_id?.trim()
      }
      return !!it.product_id
    })
  }, [customerId, items, myobImportLines.length, saving])

  const grandTotal = useMemo(() => {
    const productTotal = items.reduce((sum, it) => sum + (computedLineTotal(it) ?? 0), 0)
    const myobTotal = myobImportLines.reduce((sum, it) => sum + (it.line_total ?? 0), 0)
    return productTotal + myobTotal
  }, [items, myobImportLines])

  const displayItems = useMemo(() => sortOrderLinesByIndex(items), [items])
  const sortedMyobImportLines = useMemo(
    () => [...myobImportLines].sort((a, b) => (a.line_index || 0) - (b.line_index || 0)),
    [myobImportLines],
  )

  async function createDraft() {
    if (items.some((it) => !isValidMoneyField(it.rate))) {
      setErr('Rate must be empty or a valid non-negative number.')
      return
    }
    setErr(null)
    setSaving(true)
    try {
      if (draftOrderId) {
        await persistAllOrderLineEdits(draftOrderId, items)
        await dispatch(
          patchOrder({
            orderId: draftOrderId,
            body: {
              invoice_number: invoiceNumber.trim() || null,
              customer_purchase_order_number: customerPoNumber.trim() || null,
              order_date: orderDate || null,
            },
          }),
        ).unwrap()
        const { order: full } = await dispatch(fetchOrder(draftOrderId)).unwrap()
        applyOrderResponse(full)
        setDirty(false)
        nav(`/orders/${encodeURIComponent(draftOrderId)}/edit`, { replace: true })
        return
      }
      const productLines = items.filter((it) => it.line_kind !== 'resell')
      const resellLines = items.filter((it) => it.line_kind === 'resell')
      const res = await dispatch(
        createOrder({
          customer_id: customerId,
          status: 'draft',
          ...(invoiceNumber.trim() ? { invoice_number: invoiceNumber.trim() } : {}),
          ...(customerPoNumber.trim() ? { customer_purchase_order_number: customerPoNumber.trim() } : {}),
          ...(orderDate ? { order_date: orderDate } : {}),
          items: productLines.map((it) => {
            const rate = parseOptionalMoney(it.rate)
            const totalPrice = computedLineTotal(it)
            const qv = Number(it.quantity_value || '0')
            const qt = qtyTypeForSavedJobSheet(it.quantity_unit)
            return {
              product_id: it.product_id,
              due_date: it.due_date || null,
              quantity_unit: it.quantity_unit,
              quantity_value: qv,
              ...(rate != null ? { rate } : {}),
              ...(totalPrice != null ? { total_price: totalPrice } : {}),
              ...(qt ? { qty_type: qt } : {}),
              ...(it.quantity_unit === '1000' ? { num_product_units: Math.round(qv * 1000) } : {}),
            }
          }),
          ...(resellLines.length ? { resell_items: buildResellItemsPayloadFromLines(resellLines) } : {}),
        }),
      ).unwrap()
      setDirty(false)
      nav(`/orders/${res.order_id}/edit`, { replace: true })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create order')
    } finally {
      setSaving(false)
    }
  }

  async function saveEdits() {
    if (!orderId) return
    if (items.some((it) => !isValidMoneyField(it.rate))) {
      setErr('Rate must be empty or a valid non-negative number.')
      return
    }
    setErr(null)
    setSaving(true)
    try {
      await dispatch(
        patchOrder({
          orderId,
          body: {
            invoice_number: invoiceNumber.trim() || null,
            customer_purchase_order_number: customerPoNumber.trim() || null,
            order_date: orderDate || null,
          },
        }),
      ).unwrap()

      const orig = originalRef.current

      const updates = items.filter((it) => {
        const o = orig?.lines?.[it.id]
        if (!o) return true
        const totalNow = computedLineTotal(it)
        const totalOrig = computedLineTotal(o)
        return (
          o.due_date !== it.due_date ||
          o.quantity_unit !== it.quantity_unit ||
          o.quantity_value !== it.quantity_value ||
          o.rate !== it.rate ||
          totalNow !== totalOrig
        )
      })

      const dirtyManufactured = updates.filter((it) => it.line_kind !== 'resell')
      const dirtyResell = updates.filter((it) => it.line_kind === 'resell')
      await persistManufacturedLineEdits(dirtyManufactured)
      await persistResellLineEdits(orderId, dirtyResell)

      const { order: res } = await dispatch(fetchOrder(orderId)).unwrap()
      setOrderStatus(String(res?.status || orderStatus))
      setInvoiceNumber(String(res?.code ?? ''))
      setCustomerPoNumber(String(res?.customer_purchase_order_number ?? ''))
      setOrderDate(res?.order_date ? String(res.order_date).slice(0, 10) : '')
      const nextItems: OrderLine[] = sortOrderLinesByIndex(orderLinesFromApiItems(res?.items))
      setItems(nextItems)
      setMyobImportLines(myobLinesFromApi(res))
      originalRef.current = { lines: Object.fromEntries(nextItems.map((l) => [l.id, { ...l }])) }
      setDirty(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save changes')
    } finally {
      setSaving(false)
    }
  }

  async function removeLine(it: OrderLine) {
    const oid = effectiveOrderId
    // Before the first server-backed add, lines exist only in local state.
    if (mode === 'new' && !oid) {
      setItems((prev) => prev.filter((x) => x.id !== it.id))
      setDirty(true)
      return
    }
    if (orderLocked || !oid) return
    if (it.line_kind === 'resell') {
      const rid = it.resell_line_id || it.order_item_id
      if (!rid) return
      try {
        setErr(null)
        setSaving(true)
        await dispatch(deleteOrderResellItem({ orderId: oid, lineId: rid })).unwrap()
        const { order: res } = await dispatch(fetchOrder(oid)).unwrap()
        applyOrderResponse(res)
        setDirty(true)
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to remove line')
      } finally {
        setSaving(false)
      }
      return
    }
    if (!it.order_item_id) return
    try {
      setErr(null)
      setSaving(true)
      await dispatch(deleteOrderItem({ orderId: oid, orderItemId: it.order_item_id })).unwrap()
      const { order: res } = await dispatch(fetchOrder(oid)).unwrap()
      applyOrderResponse(res)
      setDirty(true)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to remove order item')
    } finally {
      setSaving(false)
    }
  }

  async function convertResellImportedLineToMyobJobSheet(it: OrderLine) {
    if (mode !== 'edit' || !orderId || orderLocked) return
    if (it.line_kind !== 'resell' || !resellLineHasMyobIdentifiers(it)) return
    const lineId = String(it.resell_line_id || it.order_item_id || '').trim()
    if (!lineId) return
    const ok = window.confirm(
      'Convert this outsourced manufacturing resell line into a manufactured MYOB import line with an import-draft job sheet? ' +
        'The line will move to the MYOB section until the job sheet is completed.',
    )
    if (!ok) return
    setErr(null)
    setConvertingResellLineId(lineId)
    try {
      await dispatch(convertResellLineToMyobJobSheet({ orderId, lineId })).unwrap()
      const { order: res } = await dispatch(fetchOrder(orderId)).unwrap()
      const nextItems: OrderLine[] = sortOrderLinesByIndex(orderLinesFromApiItems(res?.items))
      setItems(nextItems)
      setMyobImportLines(myobLinesFromApi(res))
      originalRef.current = { lines: Object.fromEntries(nextItems.map((l) => [l.id, { ...l }])) }
      setDirty(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to convert line')
    } finally {
      setConvertingResellLineId(null)
    }
  }

  async function submitLinkMyobLine() {
    if (mode !== 'edit' || !orderId || !linkMyobLine) return
    const js = linkMyobJobSheetId.trim()
    if (!js) {
      setErr('Enter a job sheet id.')
      return
    }
    setLinkMyobSubmitting(true)
    try {
      setErr(null)
      await dispatch(
        linkMyobImportLine({ orderId, lineId: linkMyobLine.id, job_sheet_id: js }),
      ).unwrap()
      const { order: res } = await dispatch(fetchOrder(orderId)).unwrap()
      setMyobImportLines(myobLinesFromApi(res))
      setLinkMyobOpen(false)
      setLinkMyobLine(null)
      setLinkMyobJobSheetId('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to link job sheet')
    } finally {
      setLinkMyobSubmitting(false)
    }
  }

  const title = mode === 'new' ? 'New Order' : 'Edit Order'
  const cancelTo = mode === 'edit' && orderId ? `/orders/${orderId}` : '/orders'

  function onCancel() {
    if (mode === 'edit') {
      // Prefer returning to the previous page the user came from.
      if (typeof window !== 'undefined' && window.history.length > 1) {
        nav(-1)
        return
      }
    }
    nav(cancelTo)
  }

  function renderOrderLineRow(it: OrderLine) {
    return (
      <TableRow key={it.id} hover>
        <TableCell>
          {it.line_kind === 'resell' ? (
            <strong>{it.product_name || '—'}</strong>
          ) : (
            <>
              <strong>{it.product_code}</strong>
              {it.product_name ? <span style={{ color: 'rgba(0,0,0,0.6)' }}> — {it.product_name}</span> : null}
            </>
          )}
        </TableCell>
        <TableCell>
          <TextField
            size="small"
            type="date"
            value={it.due_date}
            onChange={(e) => {
              const v = e.currentTarget.value
              setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, due_date: v } : x)))
              setDirty(true)
            }}
            InputLabelProps={{ shrink: true }}
            disabled={saving || orderLocked}
          />
        </TableCell>
        <TableCell>
          <TextField
            size="small"
            value={it.quantity_value}
            onChange={(e) => {
              const v = e.currentTarget.value
              if (!/^\d*\.?\d*$/.test(v)) return
              setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, quantity_value: v } : x)))
            }}
            inputProps={{ inputMode: 'decimal' }}
            disabled={saving || orderLocked}
          />
        </TableCell>
        <TableCell>
          <TextField
            select
            size="small"
            value={it.quantity_unit}
            onChange={(e) => {
              const v = e.target.value as QuantityUnit
              const allowed = unitChoices(it.finish_mode, it.line_kind)
              const next = allowed.includes(v) ? v : allowed[0]
              setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, quantity_unit: next } : x)))
              setDirty(true)
            }}
            sx={{ minWidth: 120 }}
            disabled={saving || orderLocked}
          >
            {unitChoices(it.finish_mode, it.line_kind, it.resell_catalog_kind).map((u) => (
              <MenuItem key={u} value={u}>
                {u === 'kg'
                  ? 'KG'
                  : u === 'rolls'
                    ? 'Roll'
                    : u === '1000'
                      ? '1000'
                      : u === 'ea'
                        ? 'Each'
                        : u === 'meters'
                          ? 'Metres'
                          : 'Carton'}
              </MenuItem>
            ))}
          </TextField>
        </TableCell>
        <TableCell>
          <TextField
            size="small"
            placeholder="—"
            value={it.rate}
            onChange={(e) => {
              const v = e.currentTarget.value
              if (v !== '' && !/^\d*\.?\d*$/.test(v)) return
              setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, rate: v } : x)))
              setDirty(true)
            }}
            inputProps={{ inputMode: 'decimal' }}
            disabled={saving || orderLocked}
          />
        </TableCell>
        <TableCell>
          <Typography variant="body2">
            {computedLineTotal(it) != null ? `$${Number(computedLineTotal(it)).toFixed(2)}` : '—'}
          </Typography>
        </TableCell>
        <TableCell align="right">
          <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
            {canEditProduct && it.line_kind !== 'resell' && (
              <Button
                size="small"
                variant="text"
                onClick={() => void openProductVersionModalForLine(it)}
                disabled={saving}
              >
                Edit
              </Button>
            )}
            {mode === 'edit' &&
            canPublish &&
            it.line_kind === 'resell' &&
            it.resell_catalog_kind === 'outsourced_manufacturing' &&
            resellLineHasMyobIdentifiers(it) ? (
              <Button
                size="small"
                variant="text"
                onClick={() => void convertResellImportedLineToMyobJobSheet(it)}
                disabled={
                  saving ||
                  orderLocked ||
                  convertingResellLineId === String(it.resell_line_id || it.order_item_id || '')
                }
                title="Use when MYOB imported this outsourced manufacturing line as resell but it should have a production job sheet."
              >
                {convertingResellLineId === String(it.resell_line_id || it.order_item_id || '')
                  ? 'Converting…'
                  : 'Convert to job sheet'}
              </Button>
            ) : null}
            <Button
              size="small"
              variant="text"
              color="error"
              onClick={() => void removeLine(it)}
              disabled={
                saving ||
                orderLocked ||
                convertingResellLineId === String(it.resell_line_id || it.order_item_id || '')
              }
            >
              Remove
            </Button>
          </Box>
        </TableCell>
      </TableRow>
    )
  }

  return (
    <Box onChange={() => setDirty(true)}>
      <Typography variant="h5" sx={{ mb: 2 }}>
        {title}
      </Typography>

      {(err || bootstrapErr || productListErr) && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {err || bootstrapErr || productListErr}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2, width: '100%' }}>
        <Stack spacing={2}>
          <CustomerSearchAutocomplete
            value={customerId}
            onChange={(id) => {
              setCustomerId(id)
              setDirty(true)
            }}
            disabled={mode === 'edit'}
            readOnlyDisplayName={customerDisplayName}
            required
            disableClearable
          />

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
            <Stack spacing={2}>
              <TextField
                label="Invoice Number"
                value={invoiceNumber}
                onChange={(e) => { setInvoiceNumber(e.target.value); setDirty(true) }}
                disabled={orderLocked}
                placeholder={mode === 'new' ? 'Leave blank to auto-generate' : undefined}
                inputProps={{ maxLength: 32 }}
              />
              <TextField
                label="Customer PO Number"
                value={customerPoNumber}
                onChange={(e) => { setCustomerPoNumber(e.target.value); setDirty(true) }}
                disabled={orderLocked}
                inputProps={{ maxLength: 128 }}
              />
            </Stack>
            <TextField
              label="Order Date"
              type="date"
              value={orderDate}
              onChange={(e) => { setOrderDate(e.target.value); setDirty(true) }}
              disabled={orderLocked}
              InputLabelProps={{ shrink: true }}
            />
          </Box>

          <Paper variant="outlined" sx={{ p: 1 }}>
            <Typography variant="subtitle2" sx={{ px: 1, pt: 1, pb: 0.5 }}>
              Products
            </Typography>
            <Table size="small" sx={{ '& .MuiTableCell-root': { px: 1 } }}>
              <TableHead>
                <TableRow>
                  <TableCell>Product</TableCell>
                  <TableCell>Due Date</TableCell>
                  <TableCell>Qty</TableCell>
                  <TableCell>Unit</TableCell>
                  <TableCell>Price ($)</TableCell>
                  <TableCell>Total ($)</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {displayItems.map((it) => renderOrderLineRow(it))}
                {mode === 'edit'
                  ? sortedMyobImportLines.map((m) => (
                      <TableRow key={`myob-${m.id}`} hover>
                        <TableCell>
                          {m.description
                            ? m.description
                            : (m.myob_item_number && String(m.myob_item_number).trim()) || '—'}
                        </TableCell>
                        <TableCell>—</TableCell>
                        <TableCell>{Number(m.ship_quantity).toLocaleString()}</TableCell>
                        <TableCell>{m.quantity_unit || '—'}</TableCell>
                        <TableCell>{m.unit_price != null ? `$${m.unit_price.toFixed(2)}` : '—'}</TableCell>
                        <TableCell>{m.line_total != null ? `$${m.line_total.toFixed(2)}` : '—'}</TableCell>
                        <TableCell align="right">
                          {m.requires_job_sheet ? (
                            m.job_sheet_id ? (
                              <Button
                                size="small"
                                variant="text"
                                onClick={() => {
                                  if (!m.linked_product_id) return
                                  const linked = items.find(
                                    (it) =>
                                      it.line_kind !== 'resell' &&
                                      jobSheetIdFromApi(it.job_sheet_id) &&
                                      String(it.job_sheet_id) === String(m.job_sheet_id),
                                  )
                                  openProductVersionModal({
                                    product_id: m.linked_product_id,
                                    product_code: m.myob_item_number,
                                    job_sheet_id: m.job_sheet_id,
                                    orderLineQty: linked
                                      ? {
                                          quantity_value: linked.quantity_value,
                                          quantity_unit: linked.quantity_unit,
                                          due_date: linked.due_date,
                                        }
                                      : null,
                                  })
                                }}
                                disabled={saving || !m.linked_product_id}
                              >
                                {m.is_import_draft ? 'Complete job sheet' : 'Open job sheet'}
                              </Button>
                            ) : (
                              <Button
                                size="small"
                                variant="outlined"
                                onClick={() => {
                                  setLinkMyobLine(m)
                                  setLinkMyobJobSheetId('')
                                  setLinkMyobOpen(true)
                                }}
                                disabled={saving || orderLocked}
                              >
                                Link job sheet
                              </Button>
                            )
                          ) : (
                            '—'
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  : null}
                <TableRow>
                  <TableCell colSpan={7} sx={{ borderBottom: 'none' }}>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }} sx={{ py: 0.5 }}>
                      <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>
                        Add product
                      </Typography>
                      <ProductSearchAutocomplete
                        customerId={customerId}
                        disabled={!customerId || saving || orderLocked}
                        resellCatalog={resellCatalog}
                        onSelectProduct={(p) => {
                          setDirty(true)
                          if (mode === 'new') void addSelectedProductToNewOrder(p)
                          else void addSelectedProductToOrder(p)
                        }}
                        onSelectResell={(rp) => {
                          setDirty(true)
                          const full = resellCatalog.find((x) => x.id === rp.id)
                          if (!full) return
                          if (mode === 'new') addResellToItemsLocal(full)
                          else void addResellToOrder(full)
                        }}
                        onNewJobSheet={() => {
                          if (!customerId) return
                          setNewJobSheetOpen(true)
                          setDirty(true)
                        }}
                        sx={{ minWidth: { xs: '100%', sm: 320 }, maxWidth: 560, flex: 1 }}
                      />
                    </Stack>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell colSpan={5} align="right" sx={{ fontWeight: 600, py: 1.5, borderBottom: 'none' }}>
                    Total
                  </TableCell>
                  <TableCell sx={{ fontWeight: 600, py: 1.5, borderBottom: 'none' }}>
                    ${grandTotal.toFixed(2)}
                  </TableCell>
                  <TableCell sx={{ borderBottom: 'none' }} />
                </TableRow>
              </TableBody>
            </Table>
          </Paper>
        </Stack>
      </Paper>

      <OrderFormFooter
        variant={mode === 'new' ? 'new' : 'edit'}
        orderId={effectiveOrderId ?? undefined}
        orderLoaded={orderLoaded}
        orderStatus={orderStatus}
        importSource={importSource}
        importReviewStatus={importReviewStatus}
        orderLocked={orderLocked}
        formBusy={saving}
        onSaveDraft={() => void createDraft()}
        saveDraftDisabled={!canSaveDraft}
        saveDraftPending={saving}
        onSaveChanges={() => void saveEdits()}
        saveChangesDisabled={!canSaveDraft}
        saveChangesPending={saving}
        onCancel={onCancel}
        onAfterPatch={async () => {
          if (!orderId || mode !== 'edit') return
          try {
            const { order: res } = await dispatch(fetchOrder(orderId)).unwrap()
            setOrderStatus(String(res?.status || 'draft'))
            setImportSource(
              res?.import_source != null && String(res.import_source).trim() ? String(res.import_source) : null,
            )
            const irs = res?.import_review_status
            setImportReviewStatus(irs === 'complete' || irs === 'incomplete' ? irs : null)
          } catch {
            /* ignore */
          }
        }}
        onAfterDelete={() => {
          setDirty(false)
          nav('/orders', { replace: true })
        }}
      />

      <Dialog
        open={linkMyobOpen}
        onClose={() => {
          if (linkMyobSubmitting) return
          setLinkMyobOpen(false)
          setLinkMyobLine(null)
          setLinkMyobJobSheetId('')
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Link job sheet to MYOB line</DialogTitle>
        <DialogContent>
          {linkMyobLine ? (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              {linkMyobLine.myob_item_number ? `${linkMyobLine.myob_item_number} — ` : null}
              {linkMyobLine.description}
            </Typography>
          ) : null}
          <TextField
            label="Job sheet id"
            value={linkMyobJobSheetId}
            onChange={(e) => setLinkMyobJobSheetId(e.target.value)}
            fullWidth
            size="small"
            placeholder="UUID of an existing job sheet for this customer"
            disabled={linkMyobSubmitting}
          />
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              if (linkMyobSubmitting) return
              setLinkMyobOpen(false)
              setLinkMyobLine(null)
              setLinkMyobJobSheetId('')
            }}
          >
            Cancel
          </Button>
          <Button variant="contained" onClick={() => void submitLinkMyobLine()} disabled={linkMyobSubmitting}>
            {linkMyobSubmitting ? 'Linking…' : 'Link'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={pvOpen}
        onClose={() => {
          if (saving) return
          closeProductVersionModal()
        }}
        maxWidth="lg"
        fullWidth
      >
        <DialogContent dividers>
          {pvProductId ? (
            <ProductVersionEditor
              key={`${pvProductId}:${pvJobSheetId ?? 'none'}`}
              productId={pvProductId}
              jobSheetId={pvJobSheetId || undefined}
              orderLineQtySnapshot={pvOrderLineQty}
              orderHeaderCustomerPurchaseOrderNumber={customerPoNumber}
              onCancel={closeProductVersionModal}
              onRepointedToNewProduct={(newProductId) => {
                setPvProductId(newProductId)
              }}
              onDone={async () => {
                const oid = effectiveOrderId
                if (!oid) {
                  closeProductVersionModal()
                  return
                }
                const localBeforeFetch = items
                try {
                  const { order: res } = await dispatch(fetchOrder(oid)).unwrap()
                  applyOrderResponse(res, {
                    preserveLocalLines: localBeforeFetch,
                    preserveFields: { rate: true },
                  })
                  setDirty(true)
                } catch {
                  // stale table until user refreshes or saves again
                } finally {
                  closeProductVersionModal()
                }
              }}
              title={pvTitle || undefined}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={newJobSheetOpen}
        onClose={() => {
          if (saving) return
          setNewJobSheetOpen(false)
        }}
        maxWidth="lg"
        fullWidth
      >
        <DialogContent dividers sx={{ p: 0 }}>
          {newJobSheetOpen && customerId && newJobSheetEmbeddedFlow ? (
            <Box sx={{ p: 2 }}>
              <ProductVersionEditor
                productId={EMBEDDED_NEW_JOB_SHEET_PRODUCT_ID}
                embeddedNewJobSheetFlow={newJobSheetEmbeddedFlow}
                title="New job sheet"
                onCancel={() => setNewJobSheetOpen(false)}
              />
            </Box>
          ) : null}
        </DialogContent>
      </Dialog>
    </Box>
  )
}

