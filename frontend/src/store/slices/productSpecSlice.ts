/**
 * Public rate-card reads for product spec forms (shared cache across SpecPayloadForm mounts).
 */
import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import { apiFetch } from '../../api/client'

export type SpecResinOption = { resin_code: string; name: string }
export type SpecColourOption = { colour_code: string; name: string; price_per_kg?: number }
export type SpecAdditiveOption = { additive_code: string; name: string; price_per_kg?: number }
export type SpecInkOption = { ink_code: string; name: string; printer_type?: string }
export type SpecPlateOption = { plate_code: string; description?: string | null }

type Status = 'idle' | 'loading' | 'succeeded' | 'failed'

export type ResinBlendPreset = {
  blend_code: string
  name: string
  components: Array<{ resin_code: string; pct: number }>
}

export type AniloxOption = { anilox_code: string; description: string }

export type CartonOptionRow = { slug: string; name: string; cost_per_unit: number; is_default: boolean }

type ProductSpecState = {
  bundle: {
    status: Status
    error: string | null
    resinBlends: ResinBlendPreset[]
    resins: SpecResinOption[]
    colours: SpecColourOption[]
    additives: SpecAdditiveOption[]
    anilox: AniloxOption[]
  }
  inks: {
    status: Status
    error: string | null
    items: SpecInkOption[]
    lastPrinterType: string | null
  }
  plates: {
    status: Status
    error: string | null
    items: SpecPlateOption[]
    lastCustomerId: string | null
  }
  cartonOptions: {
    status: Status
    error: string | null
    items: CartonOptionRow[]
  }
}

const initialState: ProductSpecState = {
  bundle: {
    status: 'idle',
    error: null,
    resinBlends: [],
    resins: [],
    colours: [],
    additives: [],
    anilox: [],
  },
  inks: { status: 'idle', error: null, items: [], lastPrinterType: null },
  plates: { status: 'idle', error: null, items: [], lastCustomerId: null },
  cartonOptions: { status: 'idle', error: null, items: [] },
}

export const fetchProductSpecBundle = createAsyncThunk('productSpec/bundle', async () => {
  const [resinBlends, resins, colours, additives, anilox] = await Promise.all([
    apiFetch<ResinBlendPreset[]>('/api/rate-cards/resin-blends'),
    apiFetch<SpecResinOption[]>('/api/rate-cards/resins'),
    apiFetch<SpecColourOption[]>('/api/rate-cards/colours'),
    apiFetch<SpecAdditiveOption[]>('/api/rate-cards/additives'),
    apiFetch<AniloxOption[]>('/api/rate-cards/anilox'),
  ])
  return {
    resinBlends: Array.isArray(resinBlends) ? resinBlends : [],
    resins: Array.isArray(resins) ? resins : [],
    colours: Array.isArray(colours) ? colours : [],
    additives: Array.isArray(additives) ? additives : [],
    anilox: Array.isArray(anilox) ? anilox : [],
  }
})

export const fetchProductSpecInks = createAsyncThunk('productSpec/inks', async (printerType: string | null) => {
  const q = printerType ? `?printer_type=${encodeURIComponent(printerType)}` : ''
  const rows = await apiFetch<SpecInkOption[]>(`/api/rate-cards/inks${q}`)
  return { printerType, items: Array.isArray(rows) ? rows : [] }
})

export const fetchProductSpecPlates = createAsyncThunk('productSpec/plates', async (customerId: string) => {
  const q = customerId.trim() ? `?customer_id=${encodeURIComponent(customerId.trim())}` : ''
  const rows = await apiFetch<Array<{ plate_code: string; description?: string | null }>>(`/api/rate-cards/plates${q}`)
  return {
    customerId: customerId.trim(),
    items: Array.isArray(rows) ? (rows as SpecPlateOption[]) : [],
  }
})

export const fetchProductSpecCartonOptions = createAsyncThunk('productSpec/cartons', async () => {
  const rb = await apiFetch<{ carton_options?: CartonOptionRow[] }>('/api/rate-cards/ratebook')
  return Array.isArray(rb.carton_options) ? rb.carton_options : []
})

const slice = createSlice({
  name: 'productSpec',
  initialState,
  reducers: {},
  extraReducers: (b) => {
    b.addCase(fetchProductSpecBundle.pending, (s) => {
      s.bundle.status = 'loading'
      s.bundle.error = null
    })
    b.addCase(fetchProductSpecBundle.fulfilled, (s, a) => {
      s.bundle.status = 'succeeded'
      s.bundle.error = null
      s.bundle.resinBlends = a.payload.resinBlends
      s.bundle.resins = a.payload.resins
      s.bundle.colours = a.payload.colours
      s.bundle.additives = a.payload.additives
      s.bundle.anilox = a.payload.anilox
    })
    b.addCase(fetchProductSpecBundle.rejected, (s, a) => {
      s.bundle.status = 'failed'
      s.bundle.error = a.error.message || 'Failed to load spec options'
    })

    b.addCase(fetchProductSpecInks.pending, (s) => {
      s.inks.status = 'loading'
      s.inks.error = null
    })
    b.addCase(fetchProductSpecInks.fulfilled, (s, a) => {
      s.inks.status = 'succeeded'
      s.inks.error = null
      s.inks.items = a.payload.items
      s.inks.lastPrinterType = a.payload.printerType
    })
    b.addCase(fetchProductSpecInks.rejected, (s, a) => {
      s.inks.status = 'failed'
      s.inks.error = a.error.message || 'Failed to load inks'
      s.inks.items = []
    })

    b.addCase(fetchProductSpecPlates.pending, (s) => {
      s.plates.status = 'loading'
      s.plates.error = null
    })
    b.addCase(fetchProductSpecPlates.fulfilled, (s, a) => {
      s.plates.status = 'succeeded'
      s.plates.error = null
      s.plates.items = a.payload.items
      s.plates.lastCustomerId = a.payload.customerId
    })
    b.addCase(fetchProductSpecPlates.rejected, (s, a) => {
      s.plates.status = 'failed'
      s.plates.error = a.error.message || 'Failed to load plates'
      s.plates.items = []
    })

    b.addCase(fetchProductSpecCartonOptions.pending, (s) => {
      s.cartonOptions.status = 'loading'
      s.cartonOptions.error = null
    })
    b.addCase(fetchProductSpecCartonOptions.fulfilled, (s, a) => {
      s.cartonOptions.status = 'succeeded'
      s.cartonOptions.error = null
      s.cartonOptions.items = a.payload
    })
    b.addCase(fetchProductSpecCartonOptions.rejected, (s) => {
      s.cartonOptions.status = 'failed'
      s.cartonOptions.error = null
      s.cartonOptions.items = []
    })
  },
})

export const productSpecReducer = slice.reducer
