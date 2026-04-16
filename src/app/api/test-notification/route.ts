import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const { title, body, level = 'info' } = await request.json()
    
    return NextResponse.json({ 
      success: true, 
      message: 'Notification sent',
      notification: { title, body, level }
    })
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to send notification' },
      { status: 500 }
    )
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'Test notification endpoint',
    usage: 'POST with { title, body, level }'
  })
} 