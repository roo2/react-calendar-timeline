const BAR_PREFIX = 'gantt-bar:'
const EMPTY_PREFIX = 'lane-empty:'
const POOL_PREFIX = 'schedule-pool:'

export function ganttBarId(machineId: string, jobId: string) {
  return `${BAR_PREFIX}${machineId}:${jobId}`
}

export function parseGanttBarId(id: string): { machineId: string; jobId: string } | null {
  if (!id.startsWith(BAR_PREFIX)) return null
  const rest = id.slice(BAR_PREFIX.length)
  const colon = rest.indexOf(':')
  if (colon === -1) return null
  return { machineId: rest.slice(0, colon), jobId: rest.slice(colon + 1) }
}

export function laneEmptyId(machineId: string) {
  return `${EMPTY_PREFIX}${machineId}`
}

export function parseLaneEmptyId(id: string): string | null {
  if (!id.startsWith(EMPTY_PREFIX)) return null
  return id.slice(EMPTY_PREFIX.length)
}

export function poolJobId(jobId: string) {
  return `${POOL_PREFIX}${jobId}`
}

export function parsePoolJobId(id: string): string | null {
  if (!id.startsWith(POOL_PREFIX)) return null
  return id.slice(POOL_PREFIX.length)
}

export const LANE_SLOT_ID_PREFIX = 'lane-slot:'

export function isLaneSlotDroppableId(id: string): boolean {
  return id.startsWith(LANE_SLOT_ID_PREFIX)
}

export function laneSlotId(machineId: string, hourIndex: number) {
  return `${LANE_SLOT_ID_PREFIX}${machineId}:${hourIndex}`
}

export function parseLaneSlotId(id: string): { machineId: string; hourIndex: number } | null {
  if (!id.startsWith(LANE_SLOT_ID_PREFIX)) return null
  const rest = id.slice(LANE_SLOT_ID_PREFIX.length)
  const colon = rest.lastIndexOf(':')
  if (colon === -1) return null
  const machineId = rest.slice(0, colon)
  const h = Number.parseInt(rest.slice(colon + 1), 10)
  if (!Number.isFinite(h) || h < 0) return null
  return { machineId, hourIndex: h }
}

/** Drop extruder jobs back to the unqueued pool */
export const SCHEDULE_UNQUEUED_ZONE_ID = 'schedule-unqueued-zone'
