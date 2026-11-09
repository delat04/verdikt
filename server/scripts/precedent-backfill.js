/*  Precedent backfill — copies every stored verdict's checks into Elasticsearch, so new verdicts have
    precedent from day one.

    npm run precedent:backfill   (from server/, reads ELASTIC_URL, ELASTIC_API_KEY and Supabase from server/.env)

    · Safe to run again: each check is stored under its verdict and criterion ids, so it's replaced, not doubled.
    · Quoted text, URLs, emails and amounts are redacted before anything leaves the database.
*/

import { db } from '../src/lib/supabase.js'
import { backfill, precedentOn } from '../src/lib/precedent.js'

if (!precedentOn()) {
  console.error('Set ELASTIC_URL and ELASTIC_API_KEY in server/.env first.')
  process.exit(1)
}
const n = await backfill(db())
console.log(`✓ Indexed ${n} checks for precedent.`)
process.exit(0)
