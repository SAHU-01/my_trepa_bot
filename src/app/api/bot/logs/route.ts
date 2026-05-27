import { NextRequest, NextResponse } from 'next/server';

// In-memory log storage for the demo. 
// Note: This will reset when the Next.js server restarts.
let logs: Array<{ id: string; timestamp: string; tag: string; message: string }> = [];

export async function GET() {
  return NextResponse.json({ logs });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { tag, message } = body;

    const newLog = {
      id: Math.random().toString(36).substring(7),
      timestamp: new Date().toISOString(),
      tag,
      message,
    };

    // Keep only the last 20 logs
    logs = [newLog, ...logs].slice(0, 20);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to add log' }, { status: 500 });
  }
}
