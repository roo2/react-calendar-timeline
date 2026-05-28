import type { SpecPayload } from '../components/SpecPayloadForm'

export function getExtruderTimePerRollHours(spec: SpecPayload, extruderCode: string | null | undefined): number | null {
  const code = String(extruderCode || '').trim()
  if (!code) return null
  const raw = spec?.production_actuals?.extruders?.[code]?.time_per_roll_hours
  const n = raw != null && raw !== '' ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? n : null
}

export function getExtruderTimePerRollMinutes(spec: SpecPayload, extruderCode: string | null | undefined): number | null {
  const hours = getExtruderTimePerRollHours(spec, extruderCode)
  return hours != null ? hours * 60 : null
}

export function setExtruderTimePerRollHours(
  spec: SpecPayload,
  extruderCode: string,
  valueHours: number | null,
): SpecPayload {
  const code = String(extruderCode || '').trim()
  if (!code) return spec
  const productionActuals = spec.production_actuals || {}
  const extruders = productionActuals.extruders || {}
  return {
    ...spec,
    production_actuals: {
      ...productionActuals,
      extruders: {
        ...extruders,
        [code]: {
          ...(extruders[code] || {}),
          time_per_roll_hours: valueHours,
        },
      },
    },
  }
}

export function setExtruderTimePerRollMinutes(
  spec: SpecPayload,
  extruderCode: string,
  valueMinutes: number | null,
): SpecPayload {
  return setExtruderTimePerRollHours(
    spec,
    extruderCode,
    valueMinutes != null && valueMinutes > 0 ? valueMinutes / 60 : null,
  )
}
