import { useDndContext } from '@dnd-kit/core'
import { useMemo } from 'react'
import { parseGanttBarId, parsePoolJobId } from './ganttIds'

/**
 * True while dragging an unqueued pool job or a bar on an extruder lane — when per-hour
 * extruder drop targets should be active. Read from DndContext so parents don't need
 * `activeId` in props (avoids re-rendering every lane on drag start).
 */
export function useExtrusionHourDropActive(extruderMachineIds: ReadonlySet<string>): boolean {
  const { active } = useDndContext()
  return useMemo(() => {
    if (!active) return false
    const id = String(active.id)
    if (parsePoolJobId(id)) return true
    const p = parseGanttBarId(id)
    return !!(p && extruderMachineIds.has(p.machineId))
  }, [active, extruderMachineIds])
}
