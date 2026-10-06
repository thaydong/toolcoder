import app from '../server';

export default function handler(req: any, res: any) {
  res.setHeader('Content-Type', 'application/json');
  req.url = '/api/config';
  return app(req, res);
}
