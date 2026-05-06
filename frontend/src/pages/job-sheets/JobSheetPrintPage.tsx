import { useEffect, useMemo, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '@mui/material'
import type { SpecPayload } from '../../components/SpecPayloadForm'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { fetchJobSheet } from '../../store/slices/jobSheetsSlice'
import { fetchQuoteRatebook } from '../../store/slices/quotesSlice'
import { computeDerivedGeometryAndTotals } from '../../utils/quoteCalculator'
import { buildSpecQuantitySliceFromPersistedJobSheet } from '../../utils/jobSheetQuantityFromApi'
import { buildQuickQuoteInputsFromSpec } from '../../utils/specToQuoteInputs'
import {
  jobSheetDescriptionWithPackagingTail,
  jobSheetOrderQuantityLabel,
} from '../../utils/quoteQuantityDescriptors'

function s(v: unknown, fallback = '—'): string {
  if (v == null) return fallback
  const t = String(v).trim()
  return t === '' ? fallback : t
}

function n(v: unknown): number | null {
  const x = Number(v)
  return Number.isFinite(x) ? x : null
}

function fmtMetres(v: number): string {
  const r = Math.round((v + Number.EPSILON) * 100) / 100
  return String(r)
}

/** Matches {@link ProductVersionSummary} / spec slugs like `2up`. */
function displayRunUp(slug: unknown): string {
  if (slug == null || slug === '' || slug === 'none') return '—'
  const str = String(slug)
  if (str === '1up' || str === '2up' || str.endsWith('up')) return str.replace('up', ' up')
  return str
}

/** Matches labels in {@link SpecPayloadForm} slit select. */
function displaySlit(raw: unknown): string {
  const key = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_')
    .replace(/\s+/g, '_')
  const map: Record<string, string> = {
    '': '—',
    none: 'None',
    one_side: 'Slit one side',
    both_sides: 'Slit both sides',
    middle: 'Slit up middle',
  }
  const fallback = String(raw ?? '').trim()
  return map[key] ?? (fallback !== '' ? fallback : '—')
}

/** Matches labels in {@link SpecPayloadForm} treat inside/outside select. */
function displayTreat(raw: unknown): string {
  const key = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_')
    .replace(/\s+/g, '_')
  const map: Record<string, string> = {
    '': '—',
    none: 'None',
    inside: 'Inside',
    outside: 'Outside',
  }
  const fallback = String(raw ?? '').trim()
  return map[key] ?? (fallback !== '' ? fallback : '—')
}

/** Matches `SpecPayloadForm` resin blend dropdown (House LD vs custom / other presets). */
function displayBlendTypeLabel(blendType: unknown): string {
  const c = String(blendType ?? '').trim()
  if (c === '' || c === 'LD') return 'House Blend (LD)'
  if (c === 'Custom') return 'Custom'
  return c
}

/** Same row filter as {@link ProductVersionSummary}. */
function meaningfulInkPlateRows(pairs: unknown): Array<{ ink: string; plate: string }> {
  return (Array.isArray(pairs) ? pairs : [])
    .map((r: { ink_code?: unknown; plate_code?: unknown }) => ({
      ink: (r?.ink_code ?? '').toString().trim(),
      plate: (r?.plate_code ?? '').toString().trim(),
    }))
    .filter((row) => row.ink || row.plate)
}

function formatPrintSide(side: unknown): string {
  const x = String(side ?? 'front')
    .trim()
    .toLowerCase()
  if (x === 'front') return 'Front'
  if (x === 'back') return 'Back'
  if (x === 'both') return 'Both'
  return s(side)
}

function formatSealType(v: unknown): string {
  const x = String(v ?? '').trim().toLowerCase()
  if (x === '') return '—'
  if (x === 'side') return 'Side'
  if (x === 'end') return 'End'
  return s(v)
}

function formatEyeSpot(v: unknown): string {
  const x = String(v ?? '').trim().toLowerCase()
  if (x === '') return '—'
  if (x === 'yes') return 'Yes'
  if (x === 'no') return 'No'
  return s(v)
}

/** Matches {@link SpecPayloadForm} `intOrDash` for film / bag readouts. */
function intOrDashJob(n: unknown): string {
  if (n == null || n === '') return '—'
  const x = typeof n === 'number' ? n : Number(String(n).trim())
  return Number.isFinite(x) && x > 0 ? String(Math.round(x)) : '—'
}

/** Same string as the printing-details modal “Film type supplied”. */
function formatJobSheetFilmSuppliedFromSpec(spec: SpecPayload): string {
  const dims = spec?.dimensions || {}
  const w = dims.base_width_mm
  const um = dims.thickness_um
  if (w == null || um == null) return '—'
  const geom = String(dims.geometry || '')
  const gusset = Number(dims.gusset_mm || 0) > 0
  const geoTag =
    geom === 'Gusset' || geom === 'BottomGusset' || gusset ? 'G' : geom === 'CentreFold' ? 'C/F' : 'L/F'
  return `${intOrDashJob(w)}mm ${intOrDashJob(um)}µm ${geoTag}`
}

/** Same string as the printing-details modal “Finished bag size”. */
function formatJobSheetFinishedBagSizeFromSpec(spec: SpecPayload): string {
  const dims = spec?.dimensions || {}
  const w = dims.base_width_mm
  const l = dims.base_length_mm
  const um = dims.thickness_um
  if (w == null) return '—'
  const parts = [`${intOrDashJob(w)}mm`]
  if (l != null) parts.push(`${intOrDashJob(l)}mm`)
  if (um != null) parts.push(`${intOrDashJob(um)}µm`)
  return parts.join(' × ')
}

function JobSheetPrintInkTable(props: { rows: Array<{ ink: string; plate: string }> }): ReactNode {
  const { rows } = props
  if (rows.length === 0) return <span className="js-print-v">—</span>
  return (
    <table className="js-print-ink" role="presentation">
      <thead>
        <tr>
          <th className="js-print-ink-num">#</th>
          <th>Ink</th>
          <th>Plate</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={`${r.ink}-${r.plate}-${i}`}>
            <td className="js-print-ink-num">{i + 1}</td>
            <td className="js-print-ink-mono">{r.ink || '—'}</td>
            <td className="js-print-ink-mono">{r.plate || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function JobSheetPrintPage() {
  const { jobSheetId } = useParams()
  const dispatch = useAppDispatch()
  const entry = useAppSelector((state) => (jobSheetId ? state.jobSheets.detail.byId[jobSheetId] : undefined))
  const data = entry?.data as { job_sheet?: Record<string, unknown>; spec_payload?: Record<string, unknown> } | null
  const err = entry?.error
  const quoteRatebook = useAppSelector((state) => state.quotes.quoteRatebook)

  useEffect(() => {
    if (!jobSheetId) return
    void dispatch(fetchJobSheet(jobSheetId))
  }, [jobSheetId, dispatch])

  useEffect(() => {
    if (quoteRatebook.status === 'idle') void dispatch(fetchQuoteRatebook())
  }, [dispatch, quoteRatebook.status])

  const model = useMemo(() => {
    const js = data?.job_sheet
    const spec = (data?.spec_payload || {}) as Record<string, any>
    const identity = (spec?.identity || {}) as Record<string, any>
    const dimensions = (spec?.dimensions || {}) as Record<string, any>
    const formulation = (spec?.formulation || {}) as Record<string, any>
    const printing = (spec?.printing || {}) as Record<string, any>
    const run = (spec?.run_requirements || {}) as Record<string, any>
    const packaging = (spec?.packaging || {}) as Record<string, any>
    const quality = (spec?.quality_expectations || {}) as Record<string, any>
    if (!js) return null

    const customer = js.customer_name ?? js.customer ?? ''
    const invoiceNo = js.invoice_no ?? ''
    const purchaseOrderNo = js.customer_purchase_order_number ?? js.purchase_order_no ?? ''
    const orderDate = js.order_date ?? ''
    const dueDate = js.due_date ?? ''
    const jobCode = js.job_no ?? ''
    const productCode = js.product_code ?? ''
    const productDescription = js.product_description ?? ''
    const notes = identity?.notes ?? run?.notes ?? packaging?.notes ?? spec?.notes ?? ''
    const qualityChecks = Array.isArray(quality?.flags)
      ? quality.flags
      : Array.isArray(spec?.quality_checks)
        ? spec.quality_checks
        : []

    const productType = identity?.product_type ?? spec?.product_type ?? '—'
    const finishMode = identity?.finish_mode ?? spec?.finish_mode ?? '—'
    const resinColourRaw =
      formulation?.colour?.colour_code ??
      formulation?.colour?.name ??
      (typeof formulation?.colour === 'string' ? formulation.colour : null) ??
      spec?.resin_colour ??
      spec?.colour ??
      ''
    const resinColourTrimmed = String(resinColourRaw ?? '').trim()
    const resinColourExplicit = resinColourTrimmed !== '' && resinColourTrimmed !== '—'
    const resinColourDisplay = resinColourExplicit ? resinColourTrimmed : 'Natural'
    const geometryLabel = dimensions?.geometry ?? spec?.geometry ?? '—'
    const widthMm = n(dimensions?.base_width_mm ?? spec?.base_width_mm)
    const widthShorthandWmm = widthMm != null && widthMm > 0 ? `${Math.round(widthMm)}Wmm` : '—'
    const ufilmLeftMm = n(dimensions?.ufilm_left_width_mm ?? spec?.ufilm_left_width_mm)
    const ufilmRightMm = n(dimensions?.ufilm_right_width_mm ?? spec?.ufilm_right_width_mm)
    const gussetMm = n(dimensions?.gusset_mm ?? spec?.gusset_mm)
    const widthTolRaw = dimensions?.width_tolerance_mm ?? spec?.width_tolerance_mm
    const widthTolMm = n(widthTolRaw)
    const widthToleranceDisplay =
      widthTolMm != null && widthTolMm > 0 ? `± ${widthTolMm} mm` : widthTolRaw != null && String(widthTolRaw).trim() !== '' ? s(widthTolRaw) : '—'

    const widthSplitMm: number[] = []
    if (ufilmLeftMm != null && ufilmLeftMm > 0) widthSplitMm.push(Math.round(ufilmLeftMm))
    if (widthMm != null && widthMm > 0) widthSplitMm.push(Math.round(widthMm))
    if (ufilmRightMm != null && ufilmRightMm > 0) widthSplitMm.push(Math.round(ufilmRightMm))

    const lengthLine = s(
      dimensions?.base_length_mm != null
        ? `${dimensions.base_length_mm} mm`
        : dimensions?.length != null
          ? dimensions.length
          : spec?.base_length_mm != null
            ? `${spec.base_length_mm} mm`
            : spec?.length,
    )
    const gaugeLine = s(
      dimensions?.thickness_um != null
        ? `${dimensions.thickness_um} um`
        : spec?.thickness_um != null
          ? `${spec.thickness_um} um`
          : spec?.gauge,
    )
    const trimPct =
      identity?.trim_pct != null
        ? `${identity.trim_pct}%`
        : spec?.trim_pct != null
          ? `${spec.trim_pct}%`
          : ''
    const gaugeTrimDisplay = trimPct !== '' ? trimPct : '—'
    const slitRaw = run?.slit ?? spec?.slit
    const treatRaw = run?.treat_inside_outside ?? run?.treat ?? spec?.treat
    const slit = displaySlit(slitRaw)
    const treat = displayTreat(treatRaw)
    const runUpLine = displayRunUp(run?.run_up ?? spec?.run_up)
    const coresLine = s(packaging?.core_type ?? spec?.core_type)

    const qv = n(js.quantity_value)
    const qtyUnitRaw = String(js.quantity_unit || '').trim().toLowerCase()
    const qtyUnit = s(js.quantity_unit, '')
    const totalKg = n(js.quantity_unit === 'kg' ? js.quantity_value : js.total_kg)
    const numRolls = n(js.num_rolls)
    const numUnits = n(js.num_product_units)
    const weightPerRoll = n(js.weight_per_roll_kg)
    const totalMStored = n(js.total_m)
    const wasteFactorPct = n(identity?.waste_factor_pct ?? spec?.waste_factor_pct)
    const wasteKg = n(spec?.waste_kg)

    const rb = quoteRatebook.data
    let geoDerived: ReturnType<typeof computeDerivedGeometryAndTotals> | null = null
    if (rb && spec && typeof spec === 'object') {
      try {
        const qtySlice = buildSpecQuantitySliceFromPersistedJobSheet(js as Record<string, unknown>, spec as SpecPayload)
        const quick = buildQuickQuoteInputsFromSpec(spec as SpecPayload, qtySlice, { ratebook: rb })
        geoDerived = computeDerivedGeometryAndTotals(quick, rb)
      } catch {
        geoDerived = null
      }
    }

    const derivedTotalM =
      geoDerived != null && geoDerived.derivedTotalM > 0 && Number.isFinite(geoDerived.derivedTotalM)
        ? geoDerived.derivedTotalM
        : null
    const derivedMPerRoll =
      geoDerived != null && geoDerived.mPerRoll != null && geoDerived.mPerRoll > 0 && Number.isFinite(geoDerived.mPerRoll)
        ? geoDerived.mPerRoll
        : null

    const finishNorm = String(finishMode || '').trim().toLowerCase()
    const highlightTotalKg = qtyUnitRaw === 'kg'
    const highlightTotalM = qtyUnitRaw === '1000' || qtyUnitRaw === 'cartons'

    let cartonConversion: { bagsPerCarton: string; totalCartons: string } | null = null
    if (finishNorm === 'cartons') {
      const bpcN = n(packaging?.bags_per_carton)
      const qtyTypeStr = String(js.qty_type || '')
      const quLower = String(js.quantity_unit || '').toLowerCase()
      let totalCtns: number | null = null
      if (qtyTypeStr === 'units' && quLower === 'cartons' && qv != null && qv > 0) {
        totalCtns = Math.max(1, Math.round(qv))
      } else if (bpcN != null && bpcN > 0 && numUnits != null && numUnits > 0) {
        totalCtns = Math.max(1, Math.ceil(numUnits / bpcN))
      } else if (
        bpcN != null &&
        bpcN > 0 &&
        totalKg != null &&
        totalKg > 0 &&
        geoDerived?.kgPerUnit != null &&
        Number(geoDerived.kgPerUnit) > 0
      ) {
        const cartonKg = bpcN * Number(geoDerived.kgPerUnit)
        totalCtns = Math.max(1, Math.round(totalKg / cartonKg))
      }
      cartonConversion = {
        bagsPerCarton: bpcN != null && bpcN > 0 ? String(Math.max(1, Math.round(bpcN))) : '—',
        totalCartons: totalCtns != null ? String(totalCtns) : '—',
      }
    }

    const blendTypeCode = String(formulation?.blend_type ?? '').trim() || 'LD'
    const hasExplicitBlendType = formulation?.blend_type != null && String(formulation.blend_type).trim() !== ''
    const legacyBlendCodeOnly =
      !hasExplicitBlendType && spec?.resin_blend_code != null && String(spec.resin_blend_code).trim() !== ''
    /** House LD preset only: no highlight on resin lines. Custom / other presets / legacy blend codes: highlight. */
    const highlightNonStandardResins = blendTypeCode !== 'LD' || legacyBlendCodeOnly

    const blendRowsRaw = Array.isArray(formulation?.blend) ? formulation.blend : Array.isArray(spec?.blend) ? spec.blend : []
    const blendRowsSorted = [...blendRowsRaw].sort((a, b) => {
      const pa = Number((a as { pct?: unknown })?.pct ?? 0)
      const pb = Number((b as { pct?: unknown })?.pct ?? 0)
      return pb - pa
    })

    const resinMixRows: Array<{ text: string; highlight: boolean }> = []

    if (formulation?.blend_type != null && String(formulation.blend_type).trim() !== '') {
      resinMixRows.push({
        text: `Resin blend: ${displayBlendTypeLabel(formulation.blend_type)}`,
        highlight: highlightNonStandardResins,
      })
    } else if (spec?.resin_blend_code != null && String(spec.resin_blend_code).trim() !== '') {
      resinMixRows.push({
        text: `Resin blend code: ${s(spec.resin_blend_code)}`,
        highlight: true,
      })
    } else if (blendRowsSorted.length > 0) {
      resinMixRows.push({
        text: `Resin blend: ${displayBlendTypeLabel('LD')}`,
        highlight: false,
      })
    }

    for (const row of blendRowsSorted) {
      const code = s((row as { code?: unknown })?.code ?? (row as { resin_code?: unknown })?.resin_code, '')
      const pct = n((row as { pct?: unknown })?.pct)
      if (code || pct != null) {
        resinMixRows.push({
          text: `${code || 'Resin'} ${pct != null ? `${pct}%` : ''}`.trim(),
          highlight: highlightNonStandardResins,
        })
      }
    }

    const colourRows = Array.isArray(formulation?.colour_components) ? formulation.colour_components : []
    for (const row of colourRows) {
      const code = s(row?.colour_code, '')
      const pct = n(row?.strength_pct)
      if (code || pct != null) {
        resinMixRows.push({
          text: `Colour ${code || ''} ${pct != null ? `${pct}%` : ''}`.trim(),
          highlight: false,
        })
      }
    }

    const additiveRows = Array.isArray(formulation?.additives) ? formulation.additives : []
    for (const row of additiveRows) {
      const code = s(row?.additive_code, '')
      const pct = n(row?.pct)
      if (code || pct != null) {
        resinMixRows.push({
          text: `Additive ${code || ''} ${pct != null ? `${pct}%` : ''}`.trim(),
          highlight: true,
        })
      }
    }

    if (resinMixRows.length === 0) resinMixRows.push({ text: '—', highlight: false })

    const printMethodDisplay = s(printing?.method ?? spec?.print_method ?? spec?.printing_method)
    const printed =
      printMethodDisplay !== '—' &&
      printMethodDisplay.trim() !== '' &&
      printMethodDisplay.trim().toLowerCase() !== 'none'

    const frontInkPlate = meaningfulInkPlateRows(printing?.front_ink_plate)
    const backInkPlate = meaningfulInkPlateRows(printing?.back_ink_plate)
    const inkCodesLegacy = Array.isArray(printing?.ink_codes)
      ? (printing.ink_codes as unknown[]).filter((x) => String(x ?? '').trim() !== '')
      : []
    const plateCodesLegacy = Array.isArray(printing?.plate_codes)
      ? (printing.plate_codes as unknown[]).filter((x) => String(x ?? '').trim() !== '')
      : []
    const artworkRefs = Array.isArray(printing?.artwork_refs)
      ? (printing.artwork_refs as unknown[]).filter((x) => String(x ?? '').trim() !== '')
      : []
    const artworkPdfNames = Array.isArray(printing?.artwork_files)
      ? (printing.artwork_files as Array<{ filename?: unknown }>)
          .map((f) => String(f?.filename ?? '').trim())
          .filter(Boolean)
      : []

    const specTyped = spec as SpecPayload
    const cylMm = n(printing?.cylinder_size_mm)
    const platesAroundDisp =
      printing?.plates_around != null && String(printing.plates_around).trim() !== '' ? s(printing.plates_around) : '—'
    const platesAcrossDisp =
      printing?.plates_across != null && String(printing.plates_across).trim() !== '' ? s(printing.plates_across) : '—'

    const legacyInkPlate =
      frontInkPlate.length === 0 && backInkPlate.length === 0 && (inkCodesLegacy.length > 0 || plateCodesLegacy.length > 0)
        ? [
            inkCodesLegacy.length ? `Inks: ${inkCodesLegacy.join(', ')}` : '',
            plateCodesLegacy.length ? `Plates: ${plateCodesLegacy.join(', ')}` : '',
          ]
            .filter(Boolean)
            .join('\n')
        : null

    const printingLayout = {
      printed,
      method: printMethodDisplay,
      printDescription: s(printing?.print_description ?? spec?.printing_notes ?? spec?.print_notes),
      barcode: s(printing?.barcode),
      numColours: s(printing?.num_colours ?? spec?.num_colours),
      printSide: formatPrintSide(printing?.side),
      treatLine: treat,
      printPosition: s(printing?.print_position_notes),
      filmSupplied: formatJobSheetFilmSuppliedFromSpec(specTyped),
      finishedBagSize: formatJobSheetFinishedBagSizeFromSpec(specTyped),
      sealType: formatSealType(run?.seal_type ?? printing?.seal_type),
      eyeSpot: formatEyeSpot(printing?.eye_spot),
      artworkRefs: artworkRefs.length ? artworkRefs.map((x) => String(x).trim()).join('; ') : '—',
      artworkPdfs: artworkPdfNames.length ? artworkPdfNames.join('; ') : '—',
      frontRows: frontInkPlate,
      backRows: backInkPlate,
      legacyInkPlate,
      cylinder: cylMm != null ? `${cylMm} mm` : '—',
      platesAround: platesAroundDisp,
      platesAcross: platesAcrossDisp,
    }

    const geoSnapshotForTail =
      derivedTotalM != null || derivedMPerRoll != null
        ? { derivedTotalM: derivedTotalM ?? 0, mPerRoll: derivedMPerRoll }
        : null
    const orderedQuantityLabel = jobSheetOrderQuantityLabel(js as Record<string, unknown>, spec as Record<string, unknown>)
    const descriptionWithPackagingTail = jobSheetDescriptionWithPackagingTail(
      String(productDescription ?? ''),
      js as Record<string, unknown>,
      spec as Record<string, unknown>,
      geoSnapshotForTail,
    )

    return {
      titleLine: `JOB SHEET ${s(jobCode, '') ? `— ${s(jobCode, '')}` : ''}`.trim(),
      header: {
        customer: s(customer),
        invoiceNo: s(invoiceNo),
        purchaseOrderNo: s(purchaseOrderNo),
        orderDate: s(orderDate),
        dueDate: s(dueDate),
        jobCode: s(jobCode),
      },
      product: {
        productCode: s(productCode),
        productDescription: s(productDescription),
        descriptionWithPackagingTail,
        orderedQuantityLabel,
        notes: s(notes),
        qualityChecks: qualityChecks.map((x: unknown) => s(x, '')).filter(Boolean),
      },
      extrusion: {
        productType: s(productType),
        finishMode: s(finishMode),
        resinColour: resinColourDisplay,
        resinColourHighlight: resinColourExplicit,
        geometryLabel: s(geometryLabel),
        geometryExtras: [
          gussetMm != null && gussetMm > 0 ? `Gusset ${Math.round(gussetMm)} mm` : '',
        ].filter(Boolean),
        widthSplitMm: widthSplitMm.length >= 2 ? widthSplitMm : null,
        widthPrimarySingle:
          widthSplitMm.length >= 2
            ? null
            : widthMm != null && widthMm > 0
              ? `${Math.round(widthMm)} mm`
              : widthShorthandWmm !== '—'
                ? widthShorthandWmm
                : '—',
        widthToleranceDisplay,
        lengthLine,
        lengthToleranceDisplay: '—',
        gaugeLine,
        gaugeTrimDisplay,
        slit,
        treat,
        runUpLine,
        coresLine,
        orderQuantities: {
          numItems: numUnits != null ? String(Math.round(numUnits)) : '—',
          rollsOrCtnsLabel: finishNorm === 'cartons' ? 'Ctns' : 'Rolls',
          numRollsOrCtns:
            finishNorm === 'cartons' && cartonConversion != null && cartonConversion.totalCartons !== '—'
              ? cartonConversion.totalCartons
              : numRolls != null
                ? String(Math.round(numRolls))
                : '—',
          totalKg: totalKg != null ? `${totalKg}` : qv != null && qtyUnit === 'kg' ? `${qv}` : '—',
          kgPerRoll:
            finishNorm === 'cartons'
              ? '—'
              : weightPerRoll != null && weightPerRoll > 0
                ? `${weightPerRoll}`
                : '—',
          totalM:
            derivedTotalM != null ? fmtMetres(derivedTotalM) : totalMStored != null ? `${totalMStored}` : '—',
          mPerRoll: derivedMPerRoll != null ? fmtMetres(derivedMPerRoll) : '—',
          wasteFactorPct,
          wasteKg: wasteKg != null ? `${wasteKg}` : null,
          highlightTotalKg,
          highlightTotalM,
        },
        resinMixRows,
      },
      printingLayout,
      shipping: {
        palletType: s(packaging?.pallet_type ?? spec?.pallet_type),
      },
      conversionInstructions: {
        carton: cartonConversion,
      },
    }
  }, [data, quoteRatebook.data])

  if (err && !data && entry?.status === 'failed') {
    return (
      <div className="js-print-root">
        <p>
          <strong>Error:</strong> {err}
        </p>
        <p>
          <Link to="/job-sheets">Back to job sheets</Link>
        </p>
      </div>
    )
  }

  if (!model) {
    return (
      <div className="js-print-root">
        <p>Loading…</p>
      </div>
    )
  }

  const e = model.extrusion
  const q = e.orderQuantities
  const conv = model.conversionInstructions
  const ship = model.shipping
  const p = model.printingLayout
  const printPath = jobSheetId ? `/job-sheets/${encodeURIComponent(jobSheetId)}/print` : ''
  const editHref = jobSheetId
    ? `/job-sheets/${encodeURIComponent(jobSheetId)}/edit?returnTo=${encodeURIComponent(printPath || '/job-sheets')}`
    : '/job-sheets'

  return (
    <>
      <style>{`
        .js-print-root, .js-print-root .js-sec, .js-print-root .js-sub, .js-print-root .js-tol, .js-print-root .js-pink, .js-print-root .js-blue, .js-print-root .js-inv-hl, .js-print-root .js-resin-mix-hl {
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
          color-adjust: exact;
        }
        @media print {
          .no-print { display: none !important; }
          @page { margin: 4mm; size: A4; }
          .js-print-root {
            max-width: none !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            font-size: 11.5pt !important;
            line-height: 1.25;
          }
          .js-grid td, .js-grid th {
            padding: 5px 7px !important;
            font-size: 10.5pt !important;
          }
          /* Nested tables are still inside .js-grid; without this, the rule above adds 5×7px inside dim/run cells only when printing. */
          .js-dim-grid td.js-dim-col {
            padding: 0 !important;
          }
          .js-dim-grid th.js-dim-h {
            padding: 6px 8px !important;
            font-size: 10pt !important;
          }
          .js-run-triple th,
          .js-run-triple td {
            padding: 6px 8px !important;
            font-size: 10pt !important;
          }
          /* Nested dim grid: flex + min-height + flex-grow prints with bogus vertical gaps in table cells (Chrome/Safari). */
          .js-dim-stack {
            display: block !important;
            min-height: 0 !important;
          }
          .js-dim-primary {
            flex: none !important;
          }
          .js-dim-grid,
          .js-run-triple {
            margin: 0 !important;
          }
          .js-extrusion-dim-run-cell .js-dim-grid {
            margin-bottom: 0 !important;
          }
          .js-dim-wrap.js-extrusion-dim-run-cell {
            padding: 0 !important;
            vertical-align: top !important;
          }
          .js-printing-wrap {
            padding: 0 !important;
            vertical-align: top !important;
          }
          .js-sec, .js-sub { font-size: 10pt !important; }
          .js-muted { font-size: 9.5pt !important; }
          .js-printing-nested > tbody > tr > th,
          .js-printing-nested > tbody > tr > td {
            padding: 3px 5px !important;
            font-size: 9.75pt !important;
          }
          .js-print-ink th,
          .js-print-ink td {
            padding: 2px 4px !important;
            font-size: 9.25pt !important;
          }
        }
        .js-print-root {
          font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
          color: #111;
          max-width: 100%;
          width: 100%;
          margin: 0 auto;
          padding: 8px 0 0;
          font-size: 13px;
        }
        .js-title {
          text-align: center;
          font-weight: 800;
          font-size: 17px;
          letter-spacing: 0.04em;
          padding: 10px 8px;
          border: 1px solid #000;
          margin-bottom: 8px;
        }
        .js-grid { width: 100%; border-collapse: collapse; table-layout: fixed; margin-bottom: 8px; }
        .js-grid td, .js-grid th {
          border: 1px solid #000;
          padding: 5px 7px;
          vertical-align: top;
          word-break: break-word;
        }
        .js-grid th { font-weight: 400; text-align: left; }
        .js-grid td { font-weight: 700; }
        .js-grid td.js-sec { font-weight: 600; text-transform: uppercase; }
        .js-grid td.js-sub { font-weight: 600; }
        .js-grid td.js-blue { font-weight: 400; }
        .js-grid td.js-td-mixed { font-weight: 400; }
        .js-print-val { font-weight: 700; }
        .js-sec { background: #d9d9d9; font-size: 11px; }
        .js-sub { background: #f2c894; font-size: 11px; }
        .js-tol { background: #fff566; font-size: 11px; }
        .js-pink { background: #ffc8d8; }
        .js-blue { background: #b4d7ff; }
        .js-inv-hl { background: #fff566; font-size: 1.05em; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
        .js-muted { color: #333; font-size: 11px; }
        .js-actions { display: flex; justify-content: flex-end; align-items: center; gap: 8px; margin-bottom: 10px; }
        .js-dim-wrap { padding: 0 !important; border-left: none !important; border-right: none !important; }
        .js-extrusion-dim-run-cell .js-dim-grid { margin-bottom: 0; }
        .js-order-qty-grid { margin-top: 14px; }
        .js-dim-grid { width: 100%; border-collapse: collapse; table-layout: fixed; margin: 0 0 8px; }
        .js-dim-grid th.js-dim-h {
          border: 2px solid #000;
          background: #d9d9d9;
          font-weight: 700;
          text-align: center;
          padding: 6px 8px;
          font-size: 11px;
          letter-spacing: 0.02em;
        }
        .js-dim-grid td.js-dim-col {
          border: 2px solid #000;
          padding: 0;
          vertical-align: top;
          width: 25%;
        }
        .js-dim-stack { display: flex; flex-direction: column; min-height: 100%; }
        .js-dim-primary {
          background: #e8e8e8;
          padding: 8px 10px;
          font-weight: 700;
          flex: 1;
          text-align: center;
        }
        .js-dim-primary.js-dim-primary-left { text-align: left; }
        .js-dim-secondary {
          background: #fff566;
          padding: 6px 8px;
          font-weight: 700;
          font-size: 11px;
          border-top: 1px solid #000;
          white-space: normal;
        }
        .js-run-triple { width: 100%; border-collapse: collapse; table-layout: fixed; margin: 0; }
        .js-run-triple th {
          width: 11%;
          font-weight: 400;
          text-align: left;
          background: #f2c894;
          border: 1px solid #000;
          padding: 6px 8px;
          font-size: 11px;
        }
        .js-run-triple td { font-weight: 700; border: 1px solid #000; padding: 6px 8px; }
        .js-resin-mix-hl { background: #fff566; }
        .js-printing-wrap {
          padding: 0 !important;
          vertical-align: top;
          border-left: none !important;
          border-right: none !important;
        }
        .js-printing-nested {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
          margin: 0;
          font-size: 12px;
        }
        .js-printing-nested > tbody > tr > th {
          background: #ededed;
          font-weight: 600;
          font-size: 10px;
          letter-spacing: 0.02em;
          text-transform: uppercase;
          text-align: left;
          border: 1px solid #000;
          padding: 4px 6px;
          vertical-align: top;
        }
        .js-printing-nested > tbody > tr > td {
          border: 1px solid #000;
          padding: 4px 6px;
          font-weight: 700;
          vertical-align: top;
          word-break: break-word;
        }
        .js-printing-nested .js-print-block { padding: 5px 7px; }
        .js-print-k {
          display: block;
          font-weight: 600;
          font-size: 10px;
          color: #333;
          letter-spacing: 0.03em;
          text-transform: uppercase;
          margin-bottom: 3px;
        }
        .js-print-v { font-weight: 700; font-size: 12px; }
        .js-print-pre { white-space: pre-wrap; }
        .js-print-ink {
          width: 100%;
          border-collapse: collapse;
          margin-top: 4px;
          font-size: 11px;
        }
        .js-print-ink th,
        .js-print-ink td {
          border: 1px solid #000;
          padding: 3px 6px;
          font-weight: 600;
        }
        .js-print-ink thead th {
          background: #f2f2f2;
          font-size: 10px;
          font-weight: 600;
        }
        .js-print-ink-mono {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-weight: 700;
        }
        .js-print-ink-num { width: 2rem; text-align: center; }
        .js-print-barcode-block { padding-top: 4px !important; padding-bottom: 5px !important; }
        .js-print-barcode-k {
          font-size: 9px !important;
          letter-spacing: 0.04em;
          margin-bottom: 2px !important;
        }
        .js-print-barcode-v {
          font-size: 11px !important;
          font-weight: 600;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        }
      `}</style>

      <div className="js-print-root">
        <div className="js-actions no-print">
          <Button variant="text" color="primary" component={Link} to={editHref}>
            Edit job sheet
          </Button>
          <Button type="button" variant="contained" color="primary" onClick={() => window.print()}>
            Print
          </Button>
        </div>

        <div className="js-title">{model.titleLine}</div>

        <table className="js-grid">
          <tbody>
            <tr><td className="js-sec" colSpan={6}>Order header</td></tr>
            <tr>
              <th>Customer</th><td colSpan={2}>{model.header.customer}</td>
              <th>Invoice no.</th><td colSpan={2} className="js-inv-hl">{model.header.invoiceNo}</td>
            </tr>
            <tr>
              <th>Purchase order</th><td colSpan={2}>{model.header.purchaseOrderNo}</td>
              <th>Order date</th><td colSpan={2}>{model.header.orderDate}</td>
            </tr>
            <tr>
              <th>Job code</th><td colSpan={2}>{model.header.jobCode}</td>
              <th>Due date</th><td colSpan={2}>{model.header.dueDate}</td>
            </tr>
          </tbody>
        </table>

        <table className="js-grid">
          <tbody>
            <tr><td className="js-sec" colSpan={6}>Product</td></tr>
            <tr>
              <th>Product code</th><td colSpan={2} style={{ fontFamily: 'ui-monospace, monospace' }}>{model.product.productCode}</td>
              <th>Description</th><td colSpan={2} style={{ whiteSpace: 'pre-wrap' }}>{model.product.descriptionWithPackagingTail}</td>
            </tr>
            <tr>
              <th>Ordered quantity</th>
              <td colSpan={5}>{model.product.orderedQuantityLabel}</td>
            </tr>
            <tr><th>Notes</th><td colSpan={5} style={{ whiteSpace: 'pre-wrap' }}>{model.product.notes}</td></tr>
            <tr><th>Quality checks</th><td colSpan={5}>{model.product.qualityChecks.length ? model.product.qualityChecks.join(' · ') : '—'}</td></tr>
          </tbody>
        </table>

        <table className="js-grid">
          <tbody>
            <tr><td className="js-sec" colSpan={6}>Extrusion specifications</td></tr>
            <tr>
              <th>Product type</th><td>{e.productType}</td>
              <th>Finish</th><td>{e.finishMode}</td>
              <th className={e.resinColourHighlight ? 'js-pink' : undefined}>(Resin) colour</th>
              <td className={e.resinColourHighlight ? 'js-pink' : undefined}>{e.resinColour}</td>
            </tr>
            <tr>
              <td colSpan={6} className="js-dim-wrap js-extrusion-dim-run-cell">
                <table className="js-dim-grid" role="presentation">
                  <thead>
                    <tr>
                      <th className="js-dim-h">Geometry</th>
                      <th className="js-dim-h">Width</th>
                      <th className="js-dim-h">Length</th>
                      <th className="js-dim-h">Gauge</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="js-dim-col">
                        <div className="js-dim-stack">
                          <div className="js-dim-primary js-dim-primary-left">
                            <div>
                              Geometry: {e.geometryLabel}
                              {e.geometryExtras.length > 0 ? (
                                <>
                                  <span className="js-muted"> · </span>
                                  <span>{e.geometryExtras.join(' · ')}</span>
                                </>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="js-dim-col">
                        <div className="js-dim-stack">
                          <div className="js-dim-primary js-dim-primary-left">
                            <div>
                              Width:{' '}
                              {e.widthSplitMm && e.widthSplitMm.length >= 2
                                ? e.widthSplitMm.join(' / ')
                                : e.widthPrimarySingle ?? '—'}
                            </div>
                          </div>
                          <div className="js-dim-secondary">Tolerance: {e.widthToleranceDisplay}</div>
                        </div>
                      </td>
                      <td className="js-dim-col">
                        <div className="js-dim-stack">
                          <div className="js-dim-primary js-dim-primary-left">
                            <div>Length: {e.lengthLine}</div>
                          </div>
                          <div className="js-dim-secondary">Tolerance: {e.lengthToleranceDisplay}</div>
                        </div>
                      </td>
                      <td className="js-dim-col">
                        <div className="js-dim-stack">
                          <div className="js-dim-primary js-dim-primary-left">
                            <div>Gauge: {e.gaugeLine}</div>
                          </div>
                          <div className="js-dim-secondary">Trim: {e.gaugeTrimDisplay}</div>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
                <table className="js-run-triple" role="presentation">
                  <tbody>
                    <tr>
                      <th>Run up</th>
                      <td>{e.runUpLine}</td>
                      <th>Slit</th>
                      <td>{e.slit}</td>
                      <th>Treat</th>
                      <td>{e.treat}</td>
                      <th>Cores</th>
                      <td>{e.coresLine}</td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
            <tr><td className="js-sub" colSpan={6}>Resin mix</td></tr>
            {e.resinMixRows.map((r, idx) => (
              <tr key={idx}>
                <td colSpan={6} className={r.highlight ? 'js-resin-mix-hl' : undefined}>
                  {r.text}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <table className="js-grid js-order-qty-grid">
          <tbody>
            <tr><td className="js-sec" colSpan={6}>Order quantities</td></tr>
            <tr>
              <th>No. of items</th><td>{q.numItems}</td>
              <th>{q.rollsOrCtnsLabel}</th><td>{q.numRollsOrCtns}</td>
              <th className={q.highlightTotalKg ? 'js-pink' : undefined}>Total kg</th>
              <td className={q.highlightTotalKg ? 'js-pink' : undefined}>{q.totalKg}</td>
            </tr>
            <tr>
              <th>Kg per roll</th><td>{q.kgPerRoll}</td>
              <th className={q.highlightTotalM ? 'js-pink' : undefined}>Total M</th>
              <td className={q.highlightTotalM ? 'js-pink' : undefined}>{q.totalM}</td>
              <th>M per roll</th><td>{q.mPerRoll}</td>
            </tr>
            <tr>
              <th>Waste factor</th>
              <td colSpan={5} className="js-td-mixed">
                {q.wasteFactorPct != null ? (
                  <>
                    <span className="js-print-val">{q.wasteFactorPct}%</span>
                    <span className="js-muted"> of ordered job kg (extrusion waste</span>
                    {q.wasteKg ? (
                      <>
                        <span className="js-muted">: </span>
                        <span className="js-print-val">{q.wasteKg}</span>
                        <span className="js-muted">)</span>
                      </>
                    ) : (
                      <span className="js-muted">)</span>
                    )}
                  </>
                ) : (
                  <span className="js-print-val">—</span>
                )}
              </td>
            </tr>
          </tbody>
        </table>

        <table className="js-grid">
          <tbody>
            <tr><td className="js-sec" colSpan={2}>Printing</td></tr>
            <tr>
              <td colSpan={2} className="js-printing-wrap">
                <table className="js-printing-nested" role="presentation">
                  <tbody>
                    {!p.printed ? (
                      <tr>
                        <th style={{ width: '28%' }}>Print method</th>
                        <td colSpan={2}>{p.method}</td>
                      </tr>
                    ) : (
                      <>
                        <tr>
                          <td colSpan={3} className="js-print-block">
                            <span className="js-print-k">Print description</span>
                            <div className="js-print-v js-print-pre">{p.printDescription}</div>
                          </td>
                        </tr>
                        <tr>
                          <th style={{ width: '28%' }}>Printer</th>
                          <td colSpan={2}>{p.method}</td>
                        </tr>
                        <tr>
                          <th>No. colours</th>
                          <th>Print side</th>
                          <th>Treat (in / out)</th>
                        </tr>
                        <tr>
                          <td>{p.numColours}</td>
                          <td>{p.printSide}</td>
                          <td>{p.treatLine}</td>
                        </tr>
                        <tr>
                          <td colSpan={3} className="js-print-block">
                            <span className="js-print-k">Print position details</span>
                            <div className="js-print-v js-print-pre">{p.printPosition}</div>
                          </td>
                        </tr>
                        <tr>
                          <th colSpan={2}>Film type supplied</th>
                          <th>Finished bag size</th>
                        </tr>
                        <tr>
                          <td colSpan={2}>{p.filmSupplied}</td>
                          <td>{p.finishedBagSize}</td>
                        </tr>
                        <tr>
                          <th colSpan={2}>Seal type</th>
                          <th>Eye spot</th>
                        </tr>
                        <tr>
                          <td colSpan={2}>{p.sealType}</td>
                          <td>{p.eyeSpot}</td>
                        </tr>
                        <tr>
                          <th colSpan={2}>Artwork refs</th>
                          <th>Artwork PDFs</th>
                        </tr>
                        <tr>
                          <td colSpan={2} className="js-print-pre">
                            {p.artworkRefs}
                          </td>
                          <td className="js-print-pre">{p.artworkPdfs}</td>
                        </tr>
                        <tr>
                          <td colSpan={3} className="js-print-block">
                            <span className="js-print-k">Front print</span>
                            <JobSheetPrintInkTable rows={p.frontRows} />
                          </td>
                        </tr>
                        <tr>
                          <td colSpan={3} className="js-print-block">
                            <span className="js-print-k">Back print</span>
                            <JobSheetPrintInkTable rows={p.backRows} />
                          </td>
                        </tr>
                        {p.legacyInkPlate ? (
                          <tr>
                            <td colSpan={3} className="js-print-block">
                              <span className="js-print-k">Legacy ink / plate codes</span>
                              <div className="js-print-v js-print-pre">{p.legacyInkPlate}</div>
                            </td>
                          </tr>
                        ) : null}
                        <tr>
                          <th>Cylinder</th>
                          <th>Around</th>
                          <th>Across</th>
                        </tr>
                        <tr>
                          <td>{p.cylinder}</td>
                          <td>{p.platesAround}</td>
                          <td>{p.platesAcross}</td>
                        </tr>
                        <tr>
                          <td colSpan={3} className="js-print-block js-print-barcode-block">
                            <span className="js-print-k js-print-barcode-k">Bar code</span>
                            <div className="js-print-v js-print-barcode-v">{p.barcode}</div>
                          </td>
                        </tr>
                      </>
                    )}
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>

        <table className="js-grid">
          <tbody>
            <tr>
              <td className="js-blue" colSpan={2}>
                Conversion instructions
              </td>
            </tr>
            {conv.carton ? (
              <>
                <tr>
                  <th>Total cartons</th>
                  <td>{conv.carton.totalCartons}</td>
                </tr>
                <tr>
                  <th>Bags per carton</th>
                  <td>{conv.carton.bagsPerCarton}</td>
                </tr>
              </>
            ) : null}
            <tr>
              <td colSpan={2} style={{ height: 40 }}>
                {'\u00A0'}
              </td>
            </tr>
          </tbody>
        </table>

        <table className="js-grid">
          <tbody>
            <tr><td className="js-sec" colSpan={2}>Shipping details</td></tr>
            <tr>
              <th style={{ width: '32%' }}>Pallet type</th>
              <td>{ship.palletType}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  )
}
