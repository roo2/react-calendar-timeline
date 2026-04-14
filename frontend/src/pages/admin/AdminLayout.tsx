import { NavLink, Outlet } from 'react-router-dom'
import { Box, List, ListItemButton, ListItemText, Paper, Typography } from '@mui/material'
import { useUnsavedChanges } from '../../contexts/UnsavedChangesContext'

const items = [
  { to: '/admin/resins', label: 'Resins' },
  { to: '/admin/extrusion', label: 'Extrusion' },
  { to: '/admin/printing', label: 'Printing' },
  { to: '/admin/cores', label: 'Cores' },
  { to: '/admin/tools', label: 'Tools' },
  { to: '/admin/conversion', label: 'Packing / Conversion' },
  { to: '/admin/packaging', label: 'Shipping / Pallets' },
  { to: '/admin/production-calendar', label: 'Production hours' },
]

export function AdminLayout() {
  const { setDirty } = useUnsavedChanges()
  return (
    <Box sx={{ display: { xs: 'block', md: 'flex' }, gap: 2, alignItems: 'flex-start' }} onChange={() => setDirty(true)}>
      <Paper
        variant="outlined"
        sx={{
          p: 1,
          width: { xs: '100%', md: 240 },
          position: { md: 'sticky' },
          top: { md: 80 },
        }}
      >
        <Typography variant="subtitle2" color="text.secondary" sx={{ px: 1, py: 0.5 }}>
          Admin
        </Typography>
        <List dense disablePadding>
          {items.map((i) => (
            <ListItemButton
              key={i.to}
              component={NavLink}
              to={i.to}
              sx={{
                borderRadius: 1,
                mx: 0.5,
                my: 0.25,
                '&.active': { bgcolor: 'action.selected' },
              }}
            >
              <ListItemText primary={i.label} />
            </ListItemButton>
          ))}
        </List>
      </Paper>

      <Box
        sx={{
          flex: 1,
          minWidth: 0,
          '& .MuiTableCell-root': { px: 1, py: 0.5 },
          '& .MuiTextField-root .MuiInputBase-input': { px: 1, py: 1 },
        }}
      >
        <Outlet />
      </Box>
    </Box>
  )
}

