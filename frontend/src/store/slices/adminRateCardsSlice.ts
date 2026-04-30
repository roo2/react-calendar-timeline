/**
 * Admin rate-card CRUD: shared state for /api/admin/rate-cards/* and packaging settings.
 */
import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import { apiFetch } from '../../api/client'
import type {
  Additive,
  Colour,
  Core,
  Extruder,
  ExtrusionWasteFactor,
  Ink,
  Plate,
  PrintingPricingTier,
  Resin,
  ResinBlend,
} from '../../pages/admin/types'

export type PackagingSettings = {
  packing_factor_rolls: number
  packing_factor_cartons: number
  pallet_volume_m3: number
}

/** Singleton quote_defaults row (formulation markups, extrusion retail add-ons). */
export type QuoteDefaultsSettings = {
  extrusion_retail_addon_per_kg: number
  formulation_colours_markup: number
  formulation_additives_markup: number
  formulation_custom_blend_markup: number
  extrusion_gusset_retail_per_kg: number
  extrusion_punched_retail_per_kg: number
}

export type MaterialsRetailBand = {
  id: number
  product_group: string
  width_min_mm: number
  width_max_mm: number
  moq_plain_kg: number | null
  retail_price_per_kg: number | null
  moq_printed_kg: number | null
}

export type ConversionSpeed = {
  min_gauge_um: number
  max_gauge_um: number
  min_length_mm: number
  max_length_mm: number
  bags_per_minute: number
}

export type ConversionFactor = {
  slug: string
  name: string
  value: number
}

type Status = 'idle' | 'loading' | 'succeeded' | 'failed'

function listInit<T>(): { status: Status; error: string | null; items: T[] } {
  return { status: 'idle', error: null, items: [] }
}

type AdminRateCardsState = {
  resins: ReturnType<typeof listInit<Resin>>
  additives: ReturnType<typeof listInit<Additive>>
  colours: ReturnType<typeof listInit<Colour>>
  resinBlends: ReturnType<typeof listInit<ResinBlend>>
  cores: ReturnType<typeof listInit<Core>>
  extruders: ReturnType<typeof listInit<Extruder>>
  extrusionWasteFactors: ReturnType<typeof listInit<ExtrusionWasteFactor>>
  materialsRetailBands: ReturnType<typeof listInit<MaterialsRetailBand>>
  inks: ReturnType<typeof listInit<Ink>>
  plates: ReturnType<typeof listInit<Plate>>
  printingPricingTiers: ReturnType<typeof listInit<PrintingPricingTier>>
  conversionSpeeds: ReturnType<typeof listInit<ConversionSpeed>>
  conversionFactors: ReturnType<typeof listInit<ConversionFactor>>
  packaging: {
    status: Status
    error: string | null
    data: PackagingSettings | null
  }
  quoteDefaults: {
    status: Status
    error: string | null
    data: QuoteDefaultsSettings | null
  }
  /** Used by mega AdminPage load (parallel). */
  hub: { status: Status; error: string | null }
  /** Printing sub-page bundle (tiers + inks + plates). */
  printingBundle: { status: Status; error: string | null }
  /** Resins tab (resins + additives + colours + blends). */
  resinsMaterials: { status: Status; error: string | null }
  /** Resin blends tab. */
  resinBlendsTab: { status: Status; error: string | null }
  /** Extrusion tab. */
  extrusionTab: { status: Status; error: string | null }
  /** Conversion tab. */
  conversionTab: { status: Status; error: string | null }
}

const initialState: AdminRateCardsState = {
  resins: listInit(),
  additives: listInit(),
  colours: listInit(),
  resinBlends: listInit(),
  cores: listInit(),
  extruders: listInit(),
  extrusionWasteFactors: listInit(),
  materialsRetailBands: listInit(),
  inks: listInit(),
  plates: listInit(),
  printingPricingTiers: listInit(),
  conversionSpeeds: listInit(),
  conversionFactors: listInit(),
  packaging: { status: 'idle', error: null, data: null },
  quoteDefaults: { status: 'idle', error: null, data: null },
  hub: { status: 'idle', error: null },
  printingBundle: { status: 'idle', error: null },
  resinsMaterials: { status: 'idle', error: null },
  resinBlendsTab: { status: 'idle', error: null },
  extrusionTab: { status: 'idle', error: null },
  conversionTab: { status: 'idle', error: null },
}

// --- Single-resource fetches ---

export const fetchAdminColours = createAsyncThunk('adminRateCards/colours/list', async () => {
  const rows = await apiFetch<Colour[]>('/api/admin/rate-cards/colours')
  return Array.isArray(rows) ? rows : []
})

export const fetchAdminAdditives = createAsyncThunk('adminRateCards/additives/list', async () => {
  const rows = await apiFetch<Additive[]>('/api/admin/rate-cards/additives')
  return Array.isArray(rows) ? rows : []
})

export const fetchAdminCores = createAsyncThunk('adminRateCards/cores/list', async () => {
  const rows = await apiFetch<Core[]>('/api/admin/rate-cards/cores')
  return Array.isArray(rows) ? rows : []
})

export const fetchAdminPackagingSettings = createAsyncThunk('adminRateCards/packaging/get', async () => {
  return await apiFetch<PackagingSettings>('/api/admin/rate-cards/packaging-settings')
})

export const fetchAdminQuoteDefaults = createAsyncThunk('adminRateCards/quoteDefaults/get', async () => {
  return await apiFetch<QuoteDefaultsSettings>('/api/admin/rate-cards/quote-defaults')
})

// --- Bundled fetches ---

export const fetchAdminResinsMaterials = createAsyncThunk('adminRateCards/resinsMaterials', async () => {
  const [resins, additives, colours, blends] = await Promise.all([
    apiFetch<Resin[]>('/api/admin/rate-cards/resins'),
    apiFetch<Additive[]>('/api/admin/rate-cards/additives'),
    apiFetch<Colour[]>('/api/admin/rate-cards/colours'),
    apiFetch<ResinBlend[]>('/api/admin/rate-cards/resin-blends'),
  ])
  return {
    resins: Array.isArray(resins) ? resins : [],
    additives: Array.isArray(additives) ? additives : [],
    colours: Array.isArray(colours) ? colours : [],
    blends: Array.isArray(blends) ? blends : [],
  }
})

export const fetchAdminResinBlendsTab = createAsyncThunk('adminRateCards/resinBlendsTab', async () => {
  const [resins, blends] = await Promise.all([
    apiFetch<Resin[]>('/api/admin/rate-cards/resins'),
    apiFetch<ResinBlend[]>('/api/admin/rate-cards/resin-blends'),
  ])
  return { resins: Array.isArray(resins) ? resins : [], blends: Array.isArray(blends) ? blends : [] }
})

export const fetchAdminExtrusionTab = createAsyncThunk('adminRateCards/extrusionTab', async () => {
  const [extruders, wasteFactors, materialsBands] = await Promise.all([
    apiFetch<Extruder[]>('/api/admin/rate-cards/extruders'),
    apiFetch<ExtrusionWasteFactor[]>('/api/admin/rate-cards/extrusion-waste-factors'),
    apiFetch<MaterialsRetailBand[]>('/api/admin/rate-cards/materials-retail-bands'),
  ])
  return {
    extruders: Array.isArray(extruders) ? extruders : [],
    wasteFactors: Array.isArray(wasteFactors) ? wasteFactors : [],
    materialsBands: Array.isArray(materialsBands) ? materialsBands : [],
  }
})

export const adminSaveMaterialsRetailBands = createAsyncThunk(
  'adminRateCards/materialsRetailBands/save',
  async (bands: Omit<MaterialsRetailBand, 'id'>[]) => {
    return await apiFetch<MaterialsRetailBand[]>('/api/admin/rate-cards/materials-retail-bands', {
      method: 'PUT',
      body: JSON.stringify({ bands }),
    })
  },
)

export const fetchAdminConversionTab = createAsyncThunk('adminRateCards/conversionTab', async () => {
  const [speeds, factors] = await Promise.all([
    apiFetch<ConversionSpeed[]>('/api/admin/rate-cards/conversion-speeds'),
    apiFetch<ConversionFactor[]>('/api/admin/rate-cards/conversion-factors'),
  ])
  return {
    speeds: Array.isArray(speeds) ? speeds : [],
    factors: Array.isArray(factors) ? factors : [],
  }
})

export const fetchAdminPrintingBundle = createAsyncThunk('adminRateCards/printingBundle', async () => {
  const [tiers, inks, plates] = await Promise.all([
    apiFetch<PrintingPricingTier[]>('/api/admin/rate-cards/printing-pricing-tiers'),
    apiFetch<Ink[]>('/api/admin/rate-cards/inks'),
    apiFetch<Plate[]>('/api/admin/rate-cards/plates'),
  ])
  return {
    tiers: Array.isArray(tiers) ? tiers : [],
    inks: Array.isArray(inks) ? inks : [],
    plates: Array.isArray(plates) ? plates : [],
  }
})

/** Mega load for legacy AdminPage (all rate-card lists in one shot). */
export const fetchAdminHub = createAsyncThunk('adminRateCards/hub', async () => {
  const [
    resins,
    additives,
    colours,
    cores,
    extruders,
    wf,
    inks,
    plates,
    pt,
    blends,
  ] = await Promise.all([
    apiFetch<Resin[]>('/api/admin/rate-cards/resins'),
    apiFetch<Additive[]>('/api/admin/rate-cards/additives'),
    apiFetch<Colour[]>('/api/admin/rate-cards/colours'),
    apiFetch<Core[]>('/api/admin/rate-cards/cores'),
    apiFetch<Extruder[]>('/api/admin/rate-cards/extruders'),
    apiFetch<ExtrusionWasteFactor[]>('/api/admin/rate-cards/extrusion-waste-factors'),
    apiFetch<Ink[]>('/api/admin/rate-cards/inks'),
    apiFetch<Plate[]>('/api/admin/rate-cards/plates'),
    apiFetch<PrintingPricingTier[]>('/api/admin/rate-cards/printing-pricing-tiers'),
    apiFetch<ResinBlend[]>('/api/admin/rate-cards/resin-blends'),
  ])
  return {
    resins: Array.isArray(resins) ? resins : [],
    additives: Array.isArray(additives) ? additives : [],
    colours: Array.isArray(colours) ? colours : [],
    cores: Array.isArray(cores) ? cores : [],
    extruders: Array.isArray(extruders) ? extruders : [],
    extrusionWasteFactors: Array.isArray(wf) ? wf : [],
    inks: Array.isArray(inks) ? inks : [],
    plates: Array.isArray(plates) ? plates : [],
    printingPricingTiers: Array.isArray(pt) ? pt : [],
    resinBlends: Array.isArray(blends) ? blends : [],
  }
})

// --- Mutations (PUT/DELETE); reducers merge into list state ---

export const adminSaveResin = createAsyncThunk(
  'adminRateCards/resins/save',
  async (payload: { code: string; patch: Omit<Resin, 'resin_code'> }) => {
    const trimmed = payload.code.trim()
    return await apiFetch<Resin>(`/api/admin/rate-cards/resins/${encodeURIComponent(trimmed)}`, {
      method: 'PUT',
      body: JSON.stringify(payload.patch),
    })
  },
)

export const adminDeleteResin = createAsyncThunk('adminRateCards/resins/delete', async (code: string) => {
  const trimmed = code.trim()
  await apiFetch<void>(`/api/admin/rate-cards/resins/${encodeURIComponent(trimmed)}`, { method: 'DELETE' })
  return trimmed
})

export const adminSaveResinBlend = createAsyncThunk(
  'adminRateCards/blends/save',
  async (payload: { code: string; patch: Omit<ResinBlend, 'blend_code'> }) => {
    const trimmed = payload.code.trim()
    return await apiFetch<ResinBlend>(`/api/admin/rate-cards/resin-blends/${encodeURIComponent(trimmed)}`, {
      method: 'PUT',
      body: JSON.stringify(payload.patch),
    })
  },
)

export const adminDeleteResinBlend = createAsyncThunk('adminRateCards/blends/delete', async (code: string) => {
  const trimmed = code.trim()
  await apiFetch<void>(`/api/admin/rate-cards/resin-blends/${encodeURIComponent(trimmed)}`, { method: 'DELETE' })
  return trimmed
})

export const adminSaveAdditive = createAsyncThunk(
  'adminRateCards/additives/save',
  async (payload: { code: string; patch: Omit<Additive, 'additive_code'> }) => {
    const trimmed = payload.code.trim()
    return await apiFetch<Additive>(`/api/admin/rate-cards/additives/${encodeURIComponent(trimmed)}`, {
      method: 'PUT',
      body: JSON.stringify(payload.patch),
    })
  },
)

export const adminDeleteAdditive = createAsyncThunk('adminRateCards/additives/delete', async (code: string) => {
  const trimmed = code.trim()
  await apiFetch<void>(`/api/admin/rate-cards/additives/${encodeURIComponent(trimmed)}`, { method: 'DELETE' })
  return trimmed
})

export const adminSaveColour = createAsyncThunk(
  'adminRateCards/colours/save',
  async (payload: { code: string; patch: Omit<Colour, 'colour_code'> }) => {
    const trimmed = payload.code.trim()
    return await apiFetch<Colour>(`/api/admin/rate-cards/colours/${encodeURIComponent(trimmed)}`, {
      method: 'PUT',
      body: JSON.stringify(payload.patch),
    })
  },
)

export const adminDeleteColour = createAsyncThunk('adminRateCards/colours/delete', async (code: string) => {
  const trimmed = code.trim()
  await apiFetch<void>(`/api/admin/rate-cards/colours/${encodeURIComponent(trimmed)}`, { method: 'DELETE' })
  return trimmed
})

export const adminSaveCore = createAsyncThunk(
  'adminRateCards/cores/save',
  async (payload: { coreType: string; patch: Omit<Core, 'core_type'> }) => {
    const trimmed = payload.coreType.trim()
    return await apiFetch<Core>(`/api/admin/rate-cards/cores/${encodeURIComponent(trimmed)}`, {
      method: 'PUT',
      body: JSON.stringify(payload.patch),
    })
  },
)

export const adminDeleteCore = createAsyncThunk('adminRateCards/cores/delete', async (coreType: string) => {
  const trimmed = coreType.trim()
  await apiFetch<void>(`/api/admin/rate-cards/cores/${encodeURIComponent(trimmed)}`, { method: 'DELETE' })
  return trimmed
})

export const adminSaveExtruder = createAsyncThunk(
  'adminRateCards/extruders/save',
  async (payload: { code: string; patch: Omit<Extruder, 'extruder_code'> }) => {
    const trimmed = payload.code.trim()
    return await apiFetch<Extruder>(`/api/admin/rate-cards/extruders/${encodeURIComponent(trimmed)}`, {
      method: 'PUT',
      body: JSON.stringify(payload.patch),
    })
  },
)

export const adminDeleteExtruder = createAsyncThunk('adminRateCards/extruders/delete', async (code: string) => {
  const trimmed = code.trim()
  await apiFetch<void>(`/api/admin/rate-cards/extruders/${encodeURIComponent(trimmed)}`, { method: 'DELETE' })
  return trimmed
})

export const adminSaveExtrusionWasteFactor = createAsyncThunk(
  'adminRateCards/wf/save',
  async (payload: { factor: string; patch: Omit<ExtrusionWasteFactor, 'factor'> }) => {
    const trimmed = payload.factor.trim()
    return await apiFetch<ExtrusionWasteFactor>(`/api/admin/rate-cards/extrusion-waste-factors/${encodeURIComponent(trimmed)}`, {
      method: 'PUT',
      body: JSON.stringify(payload.patch),
    })
  },
)

export const adminDeleteExtrusionWasteFactor = createAsyncThunk('adminRateCards/wf/delete', async (factor: string) => {
  const trimmed = factor.trim()
  await apiFetch<void>(`/api/admin/rate-cards/extrusion-waste-factors/${encodeURIComponent(trimmed)}`, { method: 'DELETE' })
  return trimmed
})

export const adminSaveInk = createAsyncThunk(
  'adminRateCards/inks/save',
  async (payload: { code: string; patch: Omit<Ink, 'ink_code'> }) => {
    const trimmed = payload.code.trim()
    return await apiFetch<Ink>(`/api/admin/rate-cards/inks/${encodeURIComponent(trimmed)}`, {
      method: 'PUT',
      body: JSON.stringify(payload.patch),
    })
  },
)

export const adminDeleteInk = createAsyncThunk('adminRateCards/inks/delete', async (code: string) => {
  const trimmed = code.trim()
  await apiFetch<void>(`/api/admin/rate-cards/inks/${encodeURIComponent(trimmed)}`, { method: 'DELETE' })
  return trimmed
})

export const adminSavePlate = createAsyncThunk(
  'adminRateCards/plates/save',
  async (payload: { customerId: string; plateCode: string; patch: Omit<Plate, 'customer_id' | 'plate_code'> }) => {
    const cid = payload.customerId.trim()
    const code = payload.plateCode.trim()
    return await apiFetch<Plate>(`/api/admin/rate-cards/plates/${encodeURIComponent(cid)}/${encodeURIComponent(code)}`, {
      method: 'PUT',
      body: JSON.stringify(payload.patch),
    })
  },
)

export const adminDeletePlate = createAsyncThunk(
  'adminRateCards/plates/delete',
  async (payload: { customerId: string; plateCode: string }) => {
    const cid = payload.customerId.trim()
    const code = payload.plateCode.trim()
    await apiFetch<void>(`/api/admin/rate-cards/plates/${encodeURIComponent(cid)}/${encodeURIComponent(code)}`, { method: 'DELETE' })
    return { customerId: cid, plateCode: code }
  },
)

export const adminSavePrintingTier = createAsyncThunk(
  'adminRateCards/tiers/save',
  async (payload: {
    key: { method: string; max_print_width_mm: number; num_colours: number }
    patch: Pick<
      PrintingPricingTier,
      'min_meters' | 'min_charge' | 'setup_cost' | 'setup_price' | 'cost_per_1000m' | 'price_per_1000m' | 'meters_per_min'
    >
  }) => {
    const m = (payload.key.method || '').trim().toLowerCase()
    return await apiFetch<PrintingPricingTier>(
      `/api/admin/rate-cards/printing-pricing-tiers/${encodeURIComponent(m)}/${encodeURIComponent(String(payload.key.max_print_width_mm))}/${encodeURIComponent(
        String(payload.key.num_colours),
      )}`,
      { method: 'PUT', body: JSON.stringify(payload.patch) },
    )
  },
)

export const adminDeletePrintingTier = createAsyncThunk(
  'adminRateCards/tiers/delete',
  async (key: { method: string; max_print_width_mm: number; num_colours: number }) => {
    const m = (key.method || '').trim().toLowerCase()
    await apiFetch<void>(
      `/api/admin/rate-cards/printing-pricing-tiers/${encodeURIComponent(m)}/${encodeURIComponent(String(key.max_print_width_mm))}/${encodeURIComponent(
        String(key.num_colours),
      )}`,
      { method: 'DELETE' },
    )
    return { method: m, max_print_width_mm: key.max_print_width_mm, num_colours: key.num_colours }
  },
)

export const adminSaveConversionSpeed = createAsyncThunk(
  'adminRateCards/conversionSpeed/save',
  async (payload: {
    key: Pick<ConversionSpeed, 'min_gauge_um' | 'max_gauge_um' | 'min_length_mm' | 'max_length_mm'>
    patch: Pick<ConversionSpeed, 'bags_per_minute'>
  }) => {
    const k = payload.key
    return await apiFetch<ConversionSpeed>(
      `/api/admin/rate-cards/conversion-speeds/${encodeURIComponent(String(k.min_gauge_um))}/${encodeURIComponent(String(k.max_gauge_um))}/${encodeURIComponent(
        String(k.min_length_mm),
      )}/${encodeURIComponent(String(k.max_length_mm))}`,
      { method: 'PUT', body: JSON.stringify(payload.patch) },
    )
  },
)

export const adminSaveConversionFactor = createAsyncThunk(
  'adminRateCards/conversionFactor/save',
  async (payload: { slug: string; patch: Pick<ConversionFactor, 'name' | 'value'> }) => {
    const s = payload.slug.trim()
    return await apiFetch<ConversionFactor>(`/api/admin/rate-cards/conversion-factors/${encodeURIComponent(s)}`, {
      method: 'PUT',
      body: JSON.stringify(payload.patch),
    })
  },
)

export const adminSavePackagingSettings = createAsyncThunk(
  'adminRateCards/packaging/save',
  async (payload: PackagingSettings) => {
    return await apiFetch<PackagingSettings>('/api/admin/rate-cards/packaging-settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
  },
)

export const adminSaveQuoteDefaults = createAsyncThunk(
  'adminRateCards/quoteDefaults/save',
  async (payload: QuoteDefaultsSettings) => {
    return await apiFetch<QuoteDefaultsSettings>('/api/admin/rate-cards/quote-defaults', {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
  },
)

function mergeBy<T>(items: T[], saved: T, match: (a: T, b: T) => boolean, sort?: (a: T, b: T) => number) {
  const idx = items.findIndex((x) => match(x, saved))
  let next: T[]
  if (idx === -1) {
    next = [...items, saved]
  } else {
    next = items.slice()
    next[idx] = saved
  }
  return sort ? next.sort(sort) : next
}

const slice = createSlice({
  name: 'adminRateCards',
  initialState,
  reducers: {},
  extraReducers: (b) => {
    const bindListFetch = (thunk: any, key: keyof AdminRateCardsState) => {
      b.addCase(thunk.pending, (s) => {
        ;(s[key] as any).status = 'loading'
        ;(s[key] as any).error = null
      })
      b.addCase(thunk.fulfilled, (s, a: any) => {
        ;(s[key] as any).status = 'succeeded'
        ;(s[key] as any).items = a.payload
        ;(s[key] as any).error = null
      })
      b.addCase(thunk.rejected, (s, a) => {
        ;(s[key] as any).status = 'failed'
        ;(s[key] as any).error = a.error.message || 'Failed to load'
      })
    }

    bindListFetch(fetchAdminColours, 'colours')
    bindListFetch(fetchAdminAdditives, 'additives')
    bindListFetch(fetchAdminCores, 'cores')

    b.addCase(fetchAdminPackagingSettings.pending, (s) => {
      s.packaging.status = 'loading'
      s.packaging.error = null
    })
    b.addCase(fetchAdminPackagingSettings.fulfilled, (s, a) => {
      s.packaging.status = 'succeeded'
      s.packaging.data = a.payload
      s.packaging.error = null
    })
    b.addCase(fetchAdminPackagingSettings.rejected, (s, a) => {
      s.packaging.status = 'failed'
      s.packaging.error = a.error.message || 'Failed to load packaging settings'
    })

    b.addCase(fetchAdminQuoteDefaults.pending, (s) => {
      s.quoteDefaults.status = 'loading'
      s.quoteDefaults.error = null
    })
    b.addCase(fetchAdminQuoteDefaults.fulfilled, (s, a) => {
      s.quoteDefaults.status = 'succeeded'
      s.quoteDefaults.data = a.payload
      s.quoteDefaults.error = null
    })
    b.addCase(fetchAdminQuoteDefaults.rejected, (s, a) => {
      s.quoteDefaults.status = 'failed'
      s.quoteDefaults.error = a.error.message || 'Failed to load quote defaults'
    })

    b.addCase(fetchAdminResinsMaterials.pending, (s) => {
      s.resinsMaterials.status = 'loading'
      s.resinsMaterials.error = null
    })
    b.addCase(fetchAdminResinsMaterials.fulfilled, (s, a) => {
      s.resinsMaterials.status = 'succeeded'
      s.resinsMaterials.error = null
      s.resins.items = a.payload.resins
      s.resins.status = 'succeeded'
      s.additives.items = a.payload.additives
      s.additives.status = 'succeeded'
      s.colours.items = a.payload.colours
      s.colours.status = 'succeeded'
      s.resinBlends.items = a.payload.blends
      s.resinBlends.status = 'succeeded'
    })
    b.addCase(fetchAdminResinsMaterials.rejected, (s, a) => {
      s.resinsMaterials.status = 'failed'
      s.resinsMaterials.error = a.error.message || 'Failed to load'
    })

    b.addCase(fetchAdminResinBlendsTab.pending, (s) => {
      s.resinBlendsTab.status = 'loading'
      s.resinBlendsTab.error = null
    })
    b.addCase(fetchAdminResinBlendsTab.fulfilled, (s, a) => {
      s.resinBlendsTab.status = 'succeeded'
      s.resinBlendsTab.error = null
      s.resins.items = a.payload.resins
      s.resins.status = 'succeeded'
      s.resinBlends.items = a.payload.blends
      s.resinBlends.status = 'succeeded'
    })
    b.addCase(fetchAdminResinBlendsTab.rejected, (s, a) => {
      s.resinBlendsTab.status = 'failed'
      s.resinBlendsTab.error = a.error.message || 'Failed to load'
    })

    b.addCase(fetchAdminExtrusionTab.pending, (s) => {
      s.extrusionTab.status = 'loading'
      s.extrusionTab.error = null
    })
    b.addCase(fetchAdminExtrusionTab.fulfilled, (s, a) => {
      s.extrusionTab.status = 'succeeded'
      s.extrusionTab.error = null
      s.extruders.items = a.payload.extruders
      s.extruders.status = 'succeeded'
      s.extrusionWasteFactors.items = a.payload.wasteFactors
      s.extrusionWasteFactors.status = 'succeeded'
      s.materialsRetailBands.items = a.payload.materialsBands
      s.materialsRetailBands.status = 'succeeded'
    })
    b.addCase(fetchAdminExtrusionTab.rejected, (s, a) => {
      s.extrusionTab.status = 'failed'
      s.extrusionTab.error = a.error.message || 'Failed to load'
    })

    b.addCase(fetchAdminConversionTab.pending, (s) => {
      s.conversionTab.status = 'loading'
      s.conversionTab.error = null
    })
    b.addCase(fetchAdminConversionTab.fulfilled, (s, a) => {
      s.conversionTab.status = 'succeeded'
      s.conversionTab.error = null
      s.conversionSpeeds.items = a.payload.speeds
      s.conversionSpeeds.status = 'succeeded'
      s.conversionFactors.items = a.payload.factors
      s.conversionFactors.status = 'succeeded'
    })
    b.addCase(fetchAdminConversionTab.rejected, (s, a) => {
      s.conversionTab.status = 'failed'
      s.conversionTab.error = a.error.message || 'Failed to load'
    })

    b.addCase(fetchAdminPrintingBundle.pending, (s) => {
      s.printingBundle.status = 'loading'
      s.printingBundle.error = null
    })
    b.addCase(fetchAdminPrintingBundle.fulfilled, (s, a) => {
      s.printingBundle.status = 'succeeded'
      s.printingBundle.error = null
      s.printingPricingTiers.items = a.payload.tiers
      s.printingPricingTiers.status = 'succeeded'
      s.inks.items = a.payload.inks
      s.inks.status = 'succeeded'
      s.plates.items = a.payload.plates
      s.plates.status = 'succeeded'
    })
    b.addCase(fetchAdminPrintingBundle.rejected, (s, a) => {
      s.printingBundle.status = 'failed'
      s.printingBundle.error = a.error.message || 'Failed to load'
    })

    b.addCase(fetchAdminHub.pending, (s) => {
      s.hub.status = 'loading'
      s.hub.error = null
    })
    b.addCase(fetchAdminHub.fulfilled, (s, a) => {
      s.hub.status = 'succeeded'
      s.hub.error = null
      const p = a.payload
      s.resins = { status: 'succeeded', error: null, items: p.resins }
      s.additives = { status: 'succeeded', error: null, items: p.additives }
      s.colours = { status: 'succeeded', error: null, items: p.colours }
      s.cores = { status: 'succeeded', error: null, items: p.cores }
      s.extruders = { status: 'succeeded', error: null, items: p.extruders }
      s.extrusionWasteFactors = { status: 'succeeded', error: null, items: p.extrusionWasteFactors }
      s.inks = { status: 'succeeded', error: null, items: p.inks }
      s.plates = { status: 'succeeded', error: null, items: p.plates }
      s.printingPricingTiers = { status: 'succeeded', error: null, items: p.printingPricingTiers }
      s.resinBlends = { status: 'succeeded', error: null, items: p.resinBlends }
    })
    b.addCase(fetchAdminHub.rejected, (s, a) => {
      s.hub.status = 'failed'
      s.hub.error = a.error.message || 'Failed to load admin data'
    })

    // Mutations
    b.addCase(adminSaveResin.fulfilled, (s, a) => {
      const saved = a.payload
      s.resins.items = mergeBy(
        s.resins.items,
        saved,
        (x, y) => x.resin_code === y.resin_code,
        (x, y) => x.resin_code.localeCompare(y.resin_code),
      )
    })
    b.addCase(adminDeleteResin.fulfilled, (s, a) => {
      s.resins.items = s.resins.items.filter((r) => r.resin_code !== a.payload)
    })

    b.addCase(adminSaveResinBlend.fulfilled, (s, a) => {
      const saved = a.payload
      s.resinBlends.items = mergeBy(
        s.resinBlends.items,
        saved,
        (x, y) => x.blend_code === y.blend_code,
        (x, y) => x.blend_code.localeCompare(y.blend_code),
      )
    })
    b.addCase(adminDeleteResinBlend.fulfilled, (s, a) => {
      s.resinBlends.items = s.resinBlends.items.filter((b) => b.blend_code !== a.payload)
    })

    b.addCase(adminSaveAdditive.fulfilled, (s, a) => {
      const saved = a.payload
      s.additives.items = mergeBy(
        s.additives.items,
        saved,
        (x, y) => x.additive_code === y.additive_code,
        (x, y) => x.additive_code.localeCompare(y.additive_code),
      )
    })
    b.addCase(adminDeleteAdditive.fulfilled, (s, a) => {
      s.additives.items = s.additives.items.filter((x) => x.additive_code !== a.payload)
    })

    b.addCase(adminSaveColour.fulfilled, (s, a) => {
      const saved = a.payload
      s.colours.items = mergeBy(
        s.colours.items,
        saved,
        (x, y) => x.colour_code === y.colour_code,
        (x, y) => x.colour_code.localeCompare(y.colour_code),
      )
    })
    b.addCase(adminDeleteColour.fulfilled, (s, a) => {
      s.colours.items = s.colours.items.filter((x) => x.colour_code !== a.payload)
    })

    b.addCase(adminSaveCore.fulfilled, (s, a) => {
      const saved = a.payload
      s.cores.items = mergeBy(
        s.cores.items,
        saved,
        (x, y) => x.core_type === y.core_type,
        (x, y) => x.core_type.localeCompare(y.core_type),
      )
    })
    b.addCase(adminDeleteCore.fulfilled, (s, a) => {
      s.cores.items = s.cores.items.filter((x) => x.core_type !== a.payload)
    })

    b.addCase(adminSaveExtruder.fulfilled, (s, a) => {
      const saved = a.payload
      s.extruders.items = mergeBy(s.extruders.items, saved, (x, y) => x.extruder_code === y.extruder_code)
    })
    b.addCase(adminDeleteExtruder.fulfilled, (s, a) => {
      s.extruders.items = s.extruders.items.filter((x) => x.extruder_code !== a.payload)
    })

    b.addCase(adminSaveExtrusionWasteFactor.fulfilled, (s, a) => {
      const saved = a.payload
      s.extrusionWasteFactors.items = mergeBy(
        s.extrusionWasteFactors.items,
        saved,
        (x, y) => x.factor === y.factor,
        (x, y) => x.factor.localeCompare(y.factor),
      )
    })
    b.addCase(adminDeleteExtrusionWasteFactor.fulfilled, (s, a) => {
      s.extrusionWasteFactors.items = s.extrusionWasteFactors.items.filter((x) => x.factor !== a.payload)
    })

    b.addCase(adminSaveInk.fulfilled, (s, a) => {
      const saved = a.payload
      s.inks.items = mergeBy(
        s.inks.items,
        saved,
        (x, y) => x.ink_code === y.ink_code,
        (x, y) => x.ink_code.localeCompare(y.ink_code),
      )
    })
    b.addCase(adminDeleteInk.fulfilled, (s, a) => {
      s.inks.items = s.inks.items.filter((x) => x.ink_code !== a.payload)
    })

    b.addCase(adminSavePlate.fulfilled, (s, a) => {
      const saved = a.payload
      s.plates.items = mergeBy(s.plates.items, saved, (x, y) => x.customer_id === y.customer_id && x.plate_code === y.plate_code)
    })
    b.addCase(adminDeletePlate.fulfilled, (s, a) => {
      const { customerId, plateCode } = a.payload
      s.plates.items = s.plates.items.filter((p) => !(p.customer_id === customerId && p.plate_code === plateCode))
    })

    b.addCase(adminSavePrintingTier.fulfilled, (s, a) => {
      const saved = a.payload
      s.printingPricingTiers.items = mergeBy(
        s.printingPricingTiers.items,
        saved,
        (x, y) => x.method === y.method && x.max_print_width_mm === y.max_print_width_mm && x.num_colours === y.num_colours,
        (x, y) =>
          x.method.localeCompare(y.method) || x.max_print_width_mm - y.max_print_width_mm || x.num_colours - y.num_colours,
      )
    })
    b.addCase(adminDeletePrintingTier.fulfilled, (s, a) => {
      const k = a.payload
      s.printingPricingTiers.items = s.printingPricingTiers.items.filter(
        (t) => !(t.method === k.method && t.max_print_width_mm === k.max_print_width_mm && t.num_colours === k.num_colours),
      )
    })

    b.addCase(adminSaveConversionSpeed.fulfilled, (s, a) => {
      const saved = a.payload
      const sk = (x: ConversionSpeed) =>
        `${x.min_gauge_um}-${x.max_gauge_um}:${x.min_length_mm}-${x.max_length_mm}`
      s.conversionSpeeds.items = mergeBy(s.conversionSpeeds.items, saved, (x, y) => sk(x) === sk(y))
    })

    b.addCase(adminSaveConversionFactor.fulfilled, (s, a) => {
      const saved = a.payload
      s.conversionFactors.items = mergeBy(s.conversionFactors.items, saved, (x, y) => x.slug === y.slug)
    })

    b.addCase(adminSavePackagingSettings.fulfilled, (s, a) => {
      s.packaging.data = a.payload
      s.packaging.status = 'succeeded'
      s.packaging.error = null
    })

    b.addCase(adminSaveQuoteDefaults.fulfilled, (s, a) => {
      s.quoteDefaults.data = a.payload
      s.quoteDefaults.status = 'succeeded'
      s.quoteDefaults.error = null
    })

    b.addCase(adminSaveMaterialsRetailBands.fulfilled, (s, a) => {
      s.materialsRetailBands.items = a.payload
      s.materialsRetailBands.status = 'succeeded'
      s.materialsRetailBands.error = null
    })
  },
})

export const adminRateCardsReducer = slice.reducer
