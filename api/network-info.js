export default function handler(_req, res) {
  res.status(200).json({
    shop: 'IK Computers',
    vercel: true,
    lanIps: [],
    timestamp: Date.now(),
  });
}
