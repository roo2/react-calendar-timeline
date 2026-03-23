import { Box, Button, Typography } from '@mui/material'
import { Link, useParams } from 'react-router-dom'
import { OrderEditor } from './components/OrderEditor'

export function OrderEditPage() {
  const { orderId } = useParams()

  if (!orderId) {
    return (
      <Box>
        <Typography variant="h5" sx={{ mb: 2 }}>
          Edit Order
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          Missing order id.
        </Typography>
        <Button component={Link} to="/orders" variant="outlined">
          Back to Orders
        </Button>
      </Box>
    )
  }

  return <OrderEditor mode="edit" orderId={orderId} />
}

