/**
 * Cloudflare Pages Function: /api/config
 * Provides public runtime configuration from Cloudflare Environment Variables
 * Zero-Knowledge: Only public client IDs / configuration flags are served.
 */

export async function onRequest(context) {
  const googleClientId = (context.env.GOOGLE_CLIENT_ID || '').trim();

  return new Response(
    JSON.stringify({
      googleClientId,
      configured: Boolean(googleClientId)
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Access-Control-Allow-Origin': '*'
      }
    }
  );
}
