// api/health.js - Test endpoint
export default function handler(req, res) {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    message: 'API funguje!'
  });
}
