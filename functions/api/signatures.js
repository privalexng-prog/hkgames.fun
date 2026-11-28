const KV_KEY = 'victary_island_signatures';
const MAX_ENTRIES = 100;
const ALLOWED_COLORS = ['#fef08a', '#fecdd3', '#bae6fd', '#bbf7d0', '#fffbeb'];

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

export async function onRequestGet({ env }) {
  try {
    if (!env.SIGNATURES_KV) {
      return jsonResponse({ ok: false, error: 'Cloudflare 未綁定 SIGNATURES_KV' }, 500);
    }
    const raw = await env.SIGNATURES_KV.get(KV_KEY);
    const signatures = raw ? JSON.parse(raw) : [];
    return jsonResponse({ ok: true, signatures });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message || '讀取失敗' }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.SIGNATURES_KV) {
      return jsonResponse({ ok: false, error: 'Cloudflare 未綁定 SIGNATURES_KV' }, 500);
    }

    const body = await request.json();
    const name = String(body.name || '').trim().slice(0, 16);
    const message = String(body.message || '').trim().slice(0, 60);
    const badge = String(body.badge || '🏝️ 到此一遊').trim().slice(0, 16) || '🏝️ 到此一遊';
    const color = ALLOWED_COLORS.includes(body.color) ? body.color : '#fef08a';

    if (!name || !message) {
      return jsonResponse({ ok: false, error: '暱稱及留言不能為空' }, 400);
    }

    const raw = await env.SIGNATURES_KV.get(KV_KEY);
    const signatures = raw ? JSON.parse(raw) : [];

    // Hong Kong Time (UTC+8)
    const hkDate = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

    signatures.unshift({
      name,
      badge,
      color,
      message,
      date: hkDate
    });

    if (signatures.length > MAX_ENTRIES) {
      signatures.length = MAX_ENTRIES;
    }

    await env.SIGNATURES_KV.put(KV_KEY, JSON.stringify(signatures));
    return jsonResponse({ ok: true, signatures });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message || '儲存失敗' }, 500);
  }
}
