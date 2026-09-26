// TEMPORARY DIAGNOSTIC — paste this over index.ts, deploy, run once, then
// put the real function back. It reports the SHAPE of both values and never
// returns, logs or echoes either secret.

Deno.serve((req) => {
  const env = Deno.env.get('CLEANUP_SECRET');
  const hdr = req.headers.get('x-cleanup-secret');

  // Every env var name visible to the function, values never read.
  const names = Object.keys(Deno.env.toObject()).sort();

  return new Response(
    JSON.stringify(
      {
        envVarIsSet: env !== undefined,
        envLength: env?.length ?? null,
        envTrimmedLength: env?.trim().length ?? null,
        envHasWhitespace: env ? env !== env.trim() : null,

        headerReceived: hdr !== null,
        headerLength: hdr?.length ?? null,

        lengthsMatch: env !== undefined && hdr !== null ? env.length === hdr.length : null,
        valuesMatch: env !== undefined && hdr !== null ? env === hdr : null,
        matchAfterTrim:
          env !== undefined && hdr !== null ? env.trim() === hdr.trim() : null,

        // Which names exist, so a typo in the NAME is obvious.
        customSecretNames: names.filter(
          (n) => !n.startsWith('SUPABASE_') && !['DENO_DEPLOYMENT_ID', 'DENO_REGION'].includes(n),
        ),
      },
      null,
      2,
    ),
    { headers: { 'Content-Type': 'application/json' } },
  );
});
