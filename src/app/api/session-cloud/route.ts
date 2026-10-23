// GET /api/session-cloud — availability probe of the session-scoped cloud
// backend (z-ai-web-dev-sdk), cached for 60 s. Owned by agent 1-b.

import { NextResponse } from 'next/server'
import { probeSessionCloud } from '@/lib/session-cloud'

export async function GET() {
  const probe = await probeSessionCloud()
  return NextResponse.json(probe)
}
