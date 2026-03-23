import { Box, Chip, Stack, Typography } from '@mui/material'
import type { ToolboxBalance } from '../../../store/slices/scheduleSlice'

const MACHINE_LABEL_COL_PX = 140

type Props = {
  toolbox: ToolboxBalance[] | undefined
  timelineWidthPx: number
}

/**
 * SDS 15.1: pool balance for extrusion tool types, shown below extruder lanes.
 */
export function ExtrusionToolboxRow({ toolbox, timelineWidthPx }: Props) {
  const items = toolbox ?? []
  if (items.length === 0) return null

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: { xs: 'column', sm: 'row' },
        alignItems: 'stretch',
        gap: 1,
        py: 1,
        borderBottom: 1,
        borderColor: 'divider',
        bgcolor: 'action.hover',
        minWidth: { xs: '100%', sm: `${MACHINE_LABEL_COL_PX + timelineWidthPx}px` },
      }}
    >
      <Box
        sx={{
          py: 0.5,
          width: { xs: '100%', sm: MACHINE_LABEL_COL_PX },
          flexShrink: 0,
          position: { sm: 'sticky' },
          left: { sm: 0 },
          zIndex: { sm: 3 },
          bgcolor: 'action.hover',
          borderRight: { sm: 1 },
          borderColor: 'divider',
          pr: { sm: 1 },
          boxSizing: 'border-box',
        }}
      >
        <Typography variant="subtitle2">Tools</Typography>
        <Typography variant="caption" color="text.secondary">
          Extrusion pool
        </Typography>
      </Box>

      <Box sx={{ width: timelineWidthPx, minWidth: timelineWidthPx, flexShrink: 0, px: 0.5 }}>
        <Stack direction="row" gap={1} flexWrap="wrap" useFlexGap alignItems="center">
          {items.map((t) => (
            <Chip
              key={t.tool_type_code}
              size="small"
              variant="outlined"
              title={`${t.name}: ${t.available} available of ${t.total_active} (${t.reserved} reserved on schedule)`}
              label={`${t.name.split(' ')[0] ?? t.tool_type_code}: ${t.available}/${t.total_active}`}
              sx={{
                borderLeft: 4,
                borderLeftColor: t.color,
                '& .MuiChip-label': { pl: 0.5 },
              }}
            />
          ))}
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          Free / total active · reserved counts include queued extrusion jobs
        </Typography>
      </Box>
    </Box>
  )
}
