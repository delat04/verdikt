/*  ============================================================================
    Evidence files (screenshots, the recording) in the public 'evidence' bucket. Each file is named by what it
    holds: `${prefix}/${name}-${first 16 hex of its sha-256}.${ext}`, written once and never overwritten. So a
    verdict's links always show the bytes it was decided on, even when a resumed run uploads again: the same
    bytes land on the same name (already there counts as stored), different bytes on a new one.
    ============================================================================ */

import { createHash } from 'node:crypto'
import { db } from './supabase.js'

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'video/mp4': 'mp4' }

// the bucket refuses a name that exists (upsert off): with a content-addressed name that is the same file
const exists = (error) => String(error?.statusCode) === '409' || /exists|duplicate/i.test(error?.message || '')

/**
 * Store one evidence file under a name its bytes decide.
 * @param {string} prefix       `${milestoneId}/${submissionId}`
 * @param {string} name         'desktop', 'mobile', 'form', 'replay'
 * @param {Buffer} body
 * @param {string} [contentType]
 * @returns {Promise<string|null>} the public URL, or null when it couldn't be stored (the verdict goes on without it)
 */
export async function uploadEvidence(prefix, name, body, contentType = 'image/png') {
  if (!body?.length) return null
  const sha = createHash('sha256').update(body).digest('hex')
  const path = `${prefix}/${name}-${sha.slice(0, 16)}.${EXT[contentType] || 'bin'}`
  try {
    const { error } = await db().storage.from('evidence').upload(path, body, { contentType, upsert: false })
    if (error && !exists(error)) {
      console.warn('evidence: not stored', path, error.message)
      return null
    }
    return db().storage.from('evidence').getPublicUrl(path).data.publicUrl
  } catch (e) {
    console.warn('evidence: not stored', path, e.message)
    return null
  }
}
