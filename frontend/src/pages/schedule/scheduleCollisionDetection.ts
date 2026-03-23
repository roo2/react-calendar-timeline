import { closestCenter, pointerWithin, type CollisionDetection } from '@dnd-kit/core'
import { isLaneSlotDroppableId, parseGanttBarId, parsePoolJobId } from './ganttIds'

/**
 * Hour slots are many small droppables; `closestCenter` over all of them is O(n) every frame.
 * For pool / extruder-bar drags, resolve slots with `pointerWithin` on slot droppables only,
 * and use `closestCenter` on the smaller non-slot set for bar reordering and lane-empty hits.
 */
export function createScheduleCollisionDetection(
  extruderMachineIds: ReadonlySet<string>,
): CollisionDetection {
  return (args) => {
    const activeId = String(args.active.id)
    const pool = parsePoolJobId(activeId)
    const bar = parseGanttBarId(activeId)
    const needsHourSlots = !!(pool || (bar && extruderMachineIds.has(bar.machineId)))

    if (needsHourSlots && args.pointerCoordinates) {
      const slotContainers = args.droppableContainers.filter((c) => isLaneSlotDroppableId(String(c.id)))
      const onSlot = pointerWithin({ ...args, droppableContainers: slotContainers })
      if (onSlot.length) return onSlot
    }

    if (needsHourSlots && !args.pointerCoordinates) {
      return closestCenter(args)
    }

    const withoutSlots = args.droppableContainers.filter((c) => !isLaneSlotDroppableId(String(c.id)))
    return closestCenter({ ...args, droppableContainers: withoutSlots })
  }
}
