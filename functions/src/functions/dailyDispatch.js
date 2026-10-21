import { app } from '@azure/functions';
import { composeDispatch, issueNumber, sign } from '../lib/handlers.js';

/**
 * Every morning at 7:00 AEST (21:00 UTC): read the network snapshot from the Terra API,
 * write the daily "Dispatch", post it to Power Automate (Teams/email) and draft it in WordPress.
 */
app.timer('dailyDispatch', {
  schedule: '0 0 21 * * *',
  runOnStartup: false,
  handler: async (_timer, context) => {
    const api = process.env.TERRA_API_URL;
    if (!api) {
      context.warn('TERRA_API_URL not set; skipping the dispatch');
      return;
    }
    const res = await fetch(`${api.replace(/\/$/, '')}/api/logistics/snapshot`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`Snapshot request failed with ${res.status}`);
    const dispatch = composeDispatch(await res.json(), issueNumber());
    context.log(dispatch.title);

    const flow = process.env.POWER_AUTOMATE_URL;
    if (flow) {
      const body = JSON.stringify({ source: 'terra', type: 'daily-dispatch', ...dispatch });
      const headers = { 'content-type': 'application/json' };
      const signature = sign(body, process.env.WEBHOOK_SECRET);
      if (signature) headers['x-terra-signature'] = signature;
      const r = await fetch(flow, { method: 'POST', headers, body, signal: AbortSignal.timeout(10_000) });
      context.log(`Power Automate responded ${r.status}`);
    }

    const wp = process.env.WORDPRESS_URL;
    const user = process.env.WORDPRESS_USER;
    const pass = process.env.WORDPRESS_APP_PASSWORD;
    if (wp && user && pass) {
      const r = await fetch(`${wp.replace(/\/$/, '')}/wp-json/wp/v2/posts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` },
        body: JSON.stringify({ title: dispatch.title, content: dispatch.html, status: 'draft', meta: { terra_issue: dispatch.issue } }),
        signal: AbortSignal.timeout(10_000),
      });
      context.log(`WordPress draft: ${r.status}`);
    }
  },
});
