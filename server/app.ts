import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { logger } from 'hono/logger'
import { activityRoutes } from './routes/activity.ts'
import { calendarRoutes } from './routes/calendar.ts'
import { checklistRoutes } from './routes/checklists.ts'
import { commsRoutes } from './routes/comms.ts'
import { digitalRoutes } from './routes/digital.ts'
import { financeRoutes } from './routes/finance.ts'
import { gpsRoutes } from './routes/gps.ts'
import { taskRoutes } from './routes/tasks.ts'

export const app = new Hono()
if (process.env.NODE_ENV !== 'test') app.use('/api/*', logger())

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status)
  console.error(err)
  return c.json({ error: 'internal error' }, 500)
})

const routes = app
  .route('/api', activityRoutes)
  .route('/api', gpsRoutes)
  .route('/api', checklistRoutes)
  .route('/api', taskRoutes)
  .route('/api', calendarRoutes)
  .route('/api', financeRoutes)
  .route('/api', commsRoutes)
  .route('/api', digitalRoutes)
export type AppType = typeof routes
