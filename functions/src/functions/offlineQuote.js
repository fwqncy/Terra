import { app } from '@azure/functions';
import { quoteOffline } from '../lib/handlers.js';

/** POST /api/offline-quote — what a save would earn offline right now (same rules as the browser). */
app.http('offlineQuote', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'offline-quote',
  handler: async (request, context) => {
    let body;
    try {
      body = await request.json();
    } catch {
      return { status: 400, jsonBody: { title: 'Body must be JSON.' } };
    }
    const result = quoteOffline(body);
    context.log(`offline quote: ${result.status}`);
    return { status: result.status, jsonBody: result.body };
  },
});
