import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import itemsHandler from './api/items.js'
import salesOrdersHandler from './api/salesorders.js'
import ledgerHandler from './api/ledger.js'
import balanceConfirmationsHandler from './api/balance-confirmations.js'

const handlers = {
  '/items': itemsHandler,
  '/salesorders': salesOrdersHandler,
  '/ledger': ledgerHandler,
}

function localApiPlugin() {
  return {
    name: 'local-serverless-api',
    configureServer(server) {
      server.middlewares.use('/api', async (req, res, next) => {
        const pathname = new URL(req.url, `http://${req.headers.host}`).pathname
        const handler = pathname.startsWith('/balance-confirmations')
          ? balanceConfirmationsHandler
          : handlers[pathname]

        if (!handler) return next()

        res.status = function status(code) {
          res.statusCode = code
          return res
        }
        res.json = function json(body) {
          if (!res.headersSent) res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(body))
          return res
        }

        try {
          if ((pathname === '/salesorders' || pathname.startsWith('/balance-confirmations')) && req.headers['content-type']?.includes('application/json')) {
            const chunks = []
            for await (const chunk of req) chunks.push(chunk)
            req.body = JSON.parse(Buffer.concat(chunks).toString() || '{}')
          }
          await handler(req, res)
        } catch (error) {
          next(error)
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Vite does not automatically place .env values in process.env for Node handlers.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''))

  return {
    plugins: [react(), localApiPlugin()],
  }
})
