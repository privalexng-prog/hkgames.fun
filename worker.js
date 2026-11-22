const VALID_STATIONS = ['northpoint', 'meifoo', 'admiralty', 'diamondhill', 'kowloontong'];
const VALID_DIFFS = ['easy', 'normal', 'hard'];

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

    // 1. 地鐵轉車生存戰排行榜
    if (url.pathname === '/api/leaderboard' || url.pathname === '/api/leaderboard/') {
      return handleLeaderboard(request, env);
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
// Durable Object：自動分配房主（紅隊）與加入者（藍隊）並轉發即時操作
// ============================================================================
export class WaterPoloRoom {
  constructor(state, env) {
    this.state = state;
    this.host = null;
    this.guest = null;
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const url = new URL(request.url);
    let role = url.searchParams.get('role');

    // 清理已斷線嘅舊連線
    if (this.host && this.host.readyState !== 1) this.host = null;
    if (this.guest && this.guest.readyState !== 1) this.guest = null;

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
      server.send(JSON.stringify({ type: 'room_created', role: 'host' }));
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

      // 雙方到齊，通知兩邊準備開波！
      this.host.send(JSON.stringify({ type: 'matched', role: 'host' }));
      this.host.send(JSON.stringify({ type: 'peer_joined', role: 'host' }));
      this.guest.send(JSON.stringify({ type: 'matched', role: 'guest' }));
      this.guest.send(JSON.stringify({ type: 'room_joined', role: 'guest' }));
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
      } catch (e) {}

      if (role === 'host' && this.guest && this.guest.readyState === 1) {
        this.guest.send(event.data);
      } else if (role === 'guest' && this.host && this.host.readyState === 1) {
        this.host.send(event.data);
      }
    });

    const cleanup = () => {
      if (role === 'host') {
        this.host = null;
        if (this.guest && this.guest.readyState === 1) {
          this.guest.send(JSON.stringify({ type: 'peer_left' }));
          this.guest.close();
          this.guest = null;
        }
      } else {
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
