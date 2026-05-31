import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/services/supabaseClient';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('bot_logs')
      .select('id, tag, message, timestamp')
      .order('timestamp', { ascending: false })
      .limit(20);

    if (error) throw error;

    return NextResponse.json({
      logs: (data ?? []).map((r: any) => ({
        id: r.id,
        tag: r.tag,
        message: r.message,
        timestamp: r.timestamp,
      })),
    });
  } catch {
    return NextResponse.json({ logs: [] });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { tag, message } = await req.json();
    await supabaseAdmin.from('bot_logs').insert([{ tag, message }]);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to add log' }, { status: 500 });
  }
}
