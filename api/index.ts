import app from '../server';

export default function handler(req: any, res: any) {
  res.setHeader('Content-Type', 'application/json');
  try {
    return app(req, res);
  } catch (err: any) {
    console.error('Serverless function error:', err);
    res.status(500).json({ ok: false, error: err.message || 'Lỗi hệ thống Vercel Serverless' });
  }
}
