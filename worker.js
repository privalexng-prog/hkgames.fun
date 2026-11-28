const VALID_STATIONS = ['northpoint', 'meifoo', 'admiralty', 'diamondhill', 'kowloontong'];
const VALID_DIFFS = ['easy', 'normal', 'hard'];
const VALID_WP_MODES = ['classic7', 'classic5', 'beach'];

function sortEntries(list) {
  return list.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.survivalTime !== a.survivalTime) return b.survivalTime - a.survivalTime;
    if (a.collisions !== b.collisions) return a.collisions - b.collisions;
    return a.updatedAt - b.updatedAt;
  });
}

async function handleLeaderboard(request, env) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8'
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (!env.LEADERBOARD_KV) {
    return new Response(
      JSON.stringify({ ok: false, error: '尚未綁定 LEADERBOARD_KV' }),
      { status: 500, headers: corsHeaders }
    );
  }

  const url = new URL(request.url);

  if (request.method === 'GET') {
    const game = url.searchParams.get('game') || 'mtr_transfer_survival';
    const station = url.searchParams.get('station') || 'northpoint';
    const difficulty = url.searchParams.get('difficulty') || 'normal';

    if (!VALID_STATIONS.includes(station) || !VALID_DIFFS.includes(difficulty)) {
      return new Response(JSON.stringify({ ok: false, error: '無效車站或難度參數' }), { status: 400, headers: corsHeaders });
    }

    const kvKey = `lb:${game}:${station}:${difficulty}`;
    const raw = await env.LEADERBOARD_KV.get(kvKey);
    const entries = raw ? JSON.parse(raw) : [];
    return new Response(JSON.stringify({ ok: true, entries }), { headers: corsHeaders });
  }

  if (request.method === 'POST') {
    try {
      const body = await request.json();
      const game = String(body.game || 'mtr_transfer_survival').slice(0, 40);
      const username = String(body.username || '').trim().slice(0, 16);
      const station = String(body.station || '');
      const difficulty = String(body.difficulty || '');

      if (!username) {
        return new Response(JSON.stringify({ ok: false, error: '未提供 Username' }), { status: 400, headers: corsHeaders });
      }
      if (!VALID_STATIONS.includes(station) || !VALID_DIFFS.includes(difficulty)) {
        return new Response(JSON.stringify({ ok: false, error: '無效車站或難度' }), { status: 400, headers: corsHeaders });
      }

      const newRecord = {
        username,
        station,
        difficulty,
        score: Math.max(0, Math.floor(Number(body.score) || 0)),
        survivalTime: Math.max(0, Number((Number(body.survivalTime) || 0).toFixed(1))),
        collisions: Math.max(0, Math.floor(Number(body.collisions) || 0)),
        dodged: Math.max(0, Math.floor(Number(body.dodged) || 0)),
        skin: String(body.skin || 'suit').slice(0, 20),
        updatedAt: Date.now()
      };

      const kvKey = `lb:${game}:${station}:${difficulty}`;
      const raw = await env.LEADERBOARD_KV.get(kvKey);
      const entries = raw ? JSON.parse(raw) : [];

      const idx = entries.findIndex(e => e.username.toLowerCase() === username.toLowerCase());
      let updated = true;
      let bestScore = newRecord.score;

      if (idx !== -1) {
        const prev = entries[idx];
        const isBetter =
          newRecord.score > prev.score ||
          (newRecord.score === prev.score && newRecord.survivalTime > prev.survivalTime) ||
          (newRecord.score === prev.score && newRecord.survivalTime === prev.survivalTime && newRecord.collisions < prev.collisions);

        if (isBetter) {
          entries[idx] = newRecord;
        } else {
          updated = false;
          bestScore = prev.score;
        }
      } else {
        entries.push(newRecord);
      }

      const topEntries = sortEntries(entries).slice(0, 100);
      await env.LEADERBOARD_KV.put(kvKey, JSON.stringify(topEntries));

      return new Response(
        JSON.stringify({ ok: true, updated, bestScore, entries: topEntries }),
        { headers: corsHeaders }
      );
    } catch (err) {
      return new Response(JSON.stringify({ ok: false, error: '資料格式錯誤' }), { status: 400, headers: corsHeaders });
    }
  }

  return new Response(JSON.stringify({ ok: false, error: 'Method Not Allowed' }), { status: 405, headers: corsHeaders });
}

// ============================================================================
// 長洲搶包山：極限攀登 全球排行榜 & 即時狀態 API（共用 LEADERBOARD_KV）
// ============================================================================
const BUN_LB_KV_KEY = 'lb:cheung_chau_bun:global';

function getBunCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8'
  };
}

function getHKDateKey() {
  const hkNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return hkNow.toISOString().slice(0, 10);
}

function sortBunEntries(list) {
  return list.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if ((a.duration || 90) !== (b.duration || 90)) return (a.duration || 90) - (b.duration || 90);
    return (a.updatedAt || 0) - (b.updatedAt || 0);
  });
}

async function handleBunLiveStatus(request, env) {
  const corsHeaders = getBunCorsHeaders();
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (!env.LEADERBOARD_KV) {
    return new Response(JSON.stringify({ ok: false, error: '尚未綁定 LEADERBOARD_KV' }), { status: 500, headers: corsHeaders });
  }

  const todayKey = `stats:cheung_chau_bun:challenges:${getHKDateKey()}`;
  const rawCount = await env.LEADERBOARD_KV.get(todayKey);
  const todayChallenges = Math.max(1, Number(rawCount) || 0);

  return new Response(
    JSON.stringify({
      ok: true,
      onlineClimbers: 1,
      todayChallenges
    }),
    { headers: corsHeaders }
  );
}

async function handleBunLeaderboardGet(request, env) {
  const corsHeaders = getBunCorsHeaders();
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (!env.LEADERBOARD_KV) {
    return new Response(JSON.stringify({ ok: false, error: '尚未綁定 LEADERBOARD_KV' }), { status: 500, headers: corsHeaders });
  }

  const raw = await env.LEADERBOARD_KV.get(BUN_LB_KV_KEY);
  const leaderboard = raw ? JSON.parse(raw) : [];
  return new Response(JSON.stringify({ ok: true, leaderboard }), { headers: corsHeaders });
}

async function handleBunSubmitScore(request, env) {
  const corsHeaders = getBunCorsHeaders();
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Method Not Allowed' }), { status: 405, headers: corsHeaders });
  }
  if (!env.LEADERBOARD_KV) {
    return new Response(JSON.stringify({ ok: false, error: '尚未綁定 LEADERBOARD_KV' }), { status: 500, headers: corsHeaders });
  }

  try {
    const body = await request.json();
    const name = String(body.name || '無名健兒').trim().slice(0, 14) || '無名健兒';
    const rawScore = Math.floor(Number(body.score) || 0);
    const score = Math.max(0, Math.min(2500, rawScore));
    const duration = Math.max(0, Math.min(90.5, Number((Number(body.duration) || 0).toFixed(1))));
    const isDQ = Boolean(body.isDQ);
    const title = String(body.title || '長洲平安包健兒').trim().slice(0, 30);

    // 累計今日挑戰人數
    const todayKey = `stats:cheung_chau_bun:challenges:${getHKDateKey()}`;
    const prevCount = Number(await env.LEADERBOARD_KV.get(todayKey)) || 0;
    await env.LEADERBOARD_KV.put(todayKey, String(prevCount + 1), { expirationTtl: 60 * 60 * 48 });

    const raw = await env.LEADERBOARD_KV.get(BUN_LB_KV_KEY);
    const entries = raw ? JSON.parse(raw) : [];

    if (!isDQ && score > 0) {
      const newRecord = {
        name,
        score,
        title,
        duration,
        updatedAt: Date.now()
      };

      const idx = entries.findIndex(e => String(e.name || '').toLowerCase() === name.toLowerCase());
      if (idx !== -1) {
        const prev = entries[idx];
        const isBetter =
          newRecord.score > prev.score ||
          (newRecord.score === prev.score && newRecord.duration < (prev.duration || 90));
        if (isBetter) {
          entries[idx] = newRecord;
        }
      } else {
        entries.push(newRecord);
      }

      const topEntries = sortBunEntries(entries).slice(0, 50);
      await env.LEADERBOARD_KV.put(BUN_LB_KV_KEY, JSON.stringify(topEntries));

      return new Response(
        JSON.stringify({ ok: true, syncedToCloud: true, leaderboard: topEntries.slice(0, 15) }),
        { headers: corsHeaders }
      );
    }

    return new Response(
      JSON.stringify({ ok: true, syncedToCloud: true, leaderboard: sortBunEntries(entries).slice(0, 15) }),
      { headers: corsHeaders }
    );
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: '資料格式錯誤' }), { status: 400, headers: corsHeaders });
  }
}

// ============================================================================
// 維他利島公園：遊客簽名板（到此一遊）全球雲端 API（共用 LEADERBOARD_KV）
// ============================================================================
// ============================================================================
// 維他利島公園：遊客簽名板（到此一遊）全球雲端 API（支援 SIGNATURES_KV / LEADERBOARD_KV）
// ============================================================================
const SIGNATURES_KV_KEY = 'victary_island:signatures';
const SIG_ALLOWED_COLORS = ['#fef08a', '#fecdd3', '#bae6fd', '#bbf7d0', '#fffbeb'];

async function handleSignatures(request, env) {
  const corsHeaders = getBunCorsHeaders();
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const kv = env.SIGNATURES_KV || env.LEADERBOARD_KV;
  if (!kv) {
    return new Response(JSON.stringify({ ok: false, error: '尚未綁定 SIGNATURES_KV 或 LEADERBOARD_KV' }), { status: 500, headers: corsHeaders });
  }

  // 讀取所有雲端簽名
  if (request.method === 'GET') {
    try {
      const raw = await kv.get(SIGNATURES_KV_KEY);
      const signatures = raw ? JSON.parse(raw) : [];
      return new Response(JSON.stringify({ ok: true, signatures }), { headers: corsHeaders });
    } catch (err) {
      return new Response(JSON.stringify({ ok: false, error: err.message || '讀取失敗' }), { status: 500, headers: corsHeaders });
    }
  }

  // 新增遊客簽名到雲端
  if (request.method === 'POST') {
    try {
      const body = await request.json();
      const name = String(body.name || '').trim().slice(0, 16);
      const message = String(body.message || '').trim().slice(0, 60);
      const badge = String(body.badge || '🏝️ 到此一遊').trim().slice(0, 16) || '🏝️ 到此一遊';
      const color = SIG_ALLOWED_COLORS.includes(body.color) ? body.color : '#fef08a';

      if (!name || !message) {
        return new Response(JSON.stringify({ ok: false, error: '請填寫暱稱同留言內容' }), { status: 400, headers: corsHeaders });
      }

      const raw = await kv.get(SIGNATURES_KV_KEY);
      let signatures = raw ? JSON.parse(raw) : [];

      signatures.unshift({
        id: Date.now(),
        name,
        badge,
        color,
        message,
        date: getHKDateKey()
      });

      // 最多保留最新 100 張簽名便條
      signatures = signatures.slice(0, 100);
      await kv.put(SIGNATURES_KV_KEY, JSON.stringify(signatures));

      return new Response(JSON.stringify({ ok: true, signatures }), { headers: corsHeaders });
    } catch (err) {
      return new Response(JSON.stringify({ ok: false, error: err.message || '資料格式錯誤' }), { status: 400, headers: corsHeaders });
    }
  }

  return new Response(JSON.stringify({ ok: false, error: 'Method Not Allowed' }), { status: 405, headers: corsHeaders });
}

// ============================================================================
// 水球大亂鬥 1v1 連線路由（同時支援 /ws/room/XXXX 同 /api/waterpolo/ws）
// ============================================================================
async function handleWaterPoloWS(request, env, roomCode) {
  if (!env.WATERPOLO_ROOM) {
    return new Response('尚未綁定 WATERPOLO_ROOM', { status: 500 });
  }

  if (!roomCode || !/^\d{4}$/.test(roomCode)) {
    return new Response('無效的 4 位房間編號', { status: 400 });
  }

  const id = env.WATERPOLO_ROOM.idFromName(roomCode);
  const stub = env.WATERPOLO_ROOM.get(id);
  return stub.fetch(request);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. 排行榜路由（自動區分「長洲搶包山」與「地鐵轉車生存戰」）
    if (url.pathname === '/api/leaderboard' || url.pathname === '/api/leaderboard/') {
      const isMtrQuery =
        url.searchParams.has('station') ||
        url.searchParams.has('difficulty') ||
        url.searchParams.get('game') === 'mtr_transfer_survival';

      if (!isMtrQuery && (request.method === 'GET' || request.method === 'OPTIONS')) {
        return handleBunLeaderboardGet(request, env);
      }
      return handleLeaderboard(request, env);
    }

    // 1b. 長洲搶包山：即時連線狀態與上傳成績
    if (url.pathname === '/api/live-status' || url.pathname === '/api/live-status/') {
      return handleBunLiveStatus(request, env);
    }

    if (url.pathname === '/api/submit-score' || url.pathname === '/api/submit-score/') {
      return handleBunSubmitScore(request, env);
    }

    // 1c. 維他利島公園：遊客簽名板
    if (url.pathname === '/api/signatures' || url.pathname === '/api/signatures/') {
      return handleSignatures(request, env);
    }

    // 2. 水球大亂鬥 1v1 WebSocket 連線（/ws/room/7396）
    if (url.pathname.startsWith('/ws/room/')) {
      const roomCode = url.pathname.replace('/ws/room/', '').replace(/\//g, '');
      return handleWaterPoloWS(request, env, roomCode);
    }

    // 3. 備用路由（/api/waterpolo/ws?room=7396）
    if (url.pathname === '/api/waterpolo/ws') {
      const roomCode = url.searchParams.get('room');
      return handleWaterPoloWS(request, env, roomCode);
    }

    // 4. 其他網址回傳靜態網頁
    return env.ASSETS.fetch(request);
  }
};

// ============================================================================
// Durable Object：自動分配房主（紅隊）與加入者（藍隊）並同步賽制 (7v7 / 5v5 / 4v4)
// ============================================================================
export class WaterPoloRoom {
  constructor(state, env) {
    this.state = state;
    this.host = null;
    this.guest = null;
    this.subMode = 'classic7'; // 'classic7' (7v7) | 'classic5' (5v5) | 'beach' (4v4)
    this.hostProfile = null;
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const url = new URL(request.url);
    let role = url.searchParams.get('role');
    const queryMode = url.searchParams.get('mode');
    if (queryMode && VALID_WP_MODES.includes(queryMode)) {
      this.subMode = queryMode;
    }

    // 清理已斷線嘅舊連線
    if (this.host && this.host.readyState !== 1) {
      this.host = null;
      this.hostProfile = null;
    }
    if (this.guest && this.guest.readyState !== 1) {
      this.guest = null;
    }

    // 如果網址無寫明 role，第一位入房自動做 host（房主），第二位自動做 guest（加入者）
    if (!role) {
      if (!this.host) role = 'host';
      else if (!this.guest) role = 'guest';
      else role = 'full';
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    if (role === 'host') {
      if (this.host) {
        server.accept();
        server.send(JSON.stringify({ type: 'error', msg: '此房間已有房主' }));
        server.close(1008, 'Host exists');
        return new Response(null, { status: 101, webSocket: client });
      }
      this.host = server;
      server.accept();
      this.bindEvents(server, 'host');
      server.send(JSON.stringify({ type: 'room_created', role: 'host', subMode: this.subMode }));
    } else if (role === 'guest') {
      if (!this.host) {
        server.accept();
        server.send(JSON.stringify({ type: 'error', msg: '找不到房間或房主已離開' }));
        server.close(1008, 'Room not found');
        return new Response(null, { status: 101, webSocket: client });
      }
      if (this.guest) {
        server.accept();
        server.send(JSON.stringify({ type: 'error', msg: '房間已滿（2/2）' }));
        server.close(1008, 'Room full');
        return new Response(null, { status: 101, webSocket: client });
      }
      this.guest = server;
      server.accept();
      this.bindEvents(server, 'guest');

      // 雙方到齊，通知兩邊並同步目前選擇嘅賽制（7v7 / 5v5 / 4v4）！
      this.host.send(JSON.stringify({ type: 'matched', role: 'host', subMode: this.subMode }));
      this.host.send(JSON.stringify({ type: 'peer_joined', role: 'host', subMode: this.subMode }));
      this.guest.send(JSON.stringify({ type: 'matched', role: 'guest', subMode: this.subMode }));
      this.guest.send(JSON.stringify({
        type: 'room_joined',
        role: 'guest',
        subMode: this.subMode,
        profile: this.hostProfile
      }));
    } else {
      server.accept();
      server.send(JSON.stringify({ type: 'error', msg: '房間已滿（2/2）' }));
      server.close(1008, 'Room full');
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  bindEvents(ws, role) {
    ws.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data && data.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', ts: data.ts }));
          return;
        }

        // 紀錄房主最新選擇嘅賽制（classic7 / classic5 / beach）同角色造型，確保後入房嘅好友同步
        if (role === 'host' && data) {
          if (data.subMode && VALID_WP_MODES.includes(data.subMode)) {
            this.subMode = data.subMode;
          }
          if (data.profile) {
            this.hostProfile = data.profile;
          }
        }
      } catch (e) {}

      if (role === 'host' && this.guest && this.guest.readyState === 1) {
        this.guest.send(event.data);
      } else if (role === 'guest' && this.host && this.host.readyState === 1) {
        this.host.send(event.data);
      }
    });

    const cleanup = () => {
      if (role === 'host' && this.host === ws) {
        this.host = null;
        this.hostProfile = null;
        this.subMode = 'classic7';
        if (this.guest && this.guest.readyState === 1) {
          this.guest.send(JSON.stringify({ type: 'peer_left' }));
          this.guest.close();
          this.guest = null;
        }
      } else if (role === 'guest' && this.guest === ws) {
        this.guest = null;
        if (this.host && this.host.readyState === 1) {
          this.host.send(JSON.stringify({ type: 'peer_left' }));
        }
      }
    };

    ws.addEventListener('close', cleanup);
    ws.addEventListener('error', cleanup);
  }
}
