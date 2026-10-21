import { app } from '@azure/functions';
import { MongoClient } from 'mongodb';
import { sanitiseTelemetry } from '../lib/handlers.js';

let clientPromise = null;

/** One Mongo client per worker instance (reused across invocations). */
function collection() {
  const conn = process.env.COSMOS_MONGO_CONNECTION;
  if (!conn) return null;
  clientPromise ??= new MongoClient(conn, { maxPoolSize: 5, serverSelectionTimeoutMS: 3000 }).connect();
  return clientPromise.then((c) => c.db(process.env.COSMOS_DATABASE || 'terra').collection('telemetry'));
}

/** POST /api/telemetry — high-volume sim events go straight to Cosmos DB, off the main API. */
app.http('ingestTelemetry', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'telemetry',
  handler: async (request, context) => {
    let body;
    try {
      body = await request.json();
    } catch {
      return { status: 400, jsonBody: { title: 'Body must be JSON.' } };
    }
    const result = sanitiseTelemetry(body, request.headers.get('x-terra-player') ?? 'anonymous');
    if (result.error) return { status: 400, jsonBody: { title: result.error } };
    const col = collection();
    if (!col) {
      context.warn('COSMOS_MONGO_CONNECTION not set; telemetry dropped');
      return { status: 202, jsonBody: { accepted: 0, stored: false } };
    }
    if (result.events.length) await (await col).insertMany(result.events, { ordered: false });
    return { status: 202, jsonBody: { accepted: result.events.length, stored: true } };
  },
});
