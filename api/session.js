// api/session.js
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const SECRET_KEY = process.env.API_SECRET_KEY;

export default async function handler(req, res) {
  // GitHub Pages'tan gelen isteklere izin vermek için CORS başlıkları
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 1. DERS BAŞLATMA / BİTİRME (POST)
  if (req.method === 'POST') {
    const authHeader = req.headers.authorization;
    if (SECRET_KEY && authHeader !== `Bearer ${SECRET_KEY}`) {
      return res.status(401).json({ error: 'Yetkisiz erişim' });
    }

    const { duration = 50, note = 'Standart Ders' } = req.body || {};
    const durationNum = Number(duration);

    // Eğer duration 0 gönderilirse seansı sil (manuel bitirme desteği)
    if (durationNum === 0) {
      await fetch(`${UPSTASH_URL}/del/current_session`, {
        headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
      });
      return res.status(200).json({ success: true, message: 'Seans sonlandırıldı' });
    }

    const sessionData = {
      startedAt: Date.now(),
      durationMinutes: durationNum,
      note
    };

    // Redis TTL: Ders süresi + 15 dakika sonra key otomatik silinir
    const ttlSeconds = (durationNum + 15) * 60;
    await fetch(`${UPSTASH_URL}/set/current_session/${encodeURIComponent(JSON.stringify(sessionData))}?ex=${ttlSeconds}`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
    });

    return res.status(200).json({ success: true, session: sessionData });
  }

  // 2. DURUM KONTROLÜ (GET)
  if (req.method === 'GET') {
    const response = await fetch(`${UPSTASH_URL}/get/current_session`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
    });
    const data = await response.json();

    if (!data.result) {
      return res.status(200).json({ active: false });
    }

    const session = JSON.parse(data.result);
    const now = Date.now();
    const endsAt = session.startedAt + session.durationMinutes * 60 * 1000;
    const remainingMs = endsAt - now;

    if (remainingMs <= 0) {
      return res.status(200).json({ active: false });
    }

    return res.status(200).json({
      active: true,
      startedAt: session.startedAt,
      endsAt,
      durationMinutes: session.durationMinutes,
      note: session.note,
      remainingSeconds: Math.floor(remainingMs / 1000)
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
