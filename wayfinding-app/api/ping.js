module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json({
    ok: true,
    hasKey: !!process.env.GROQ_API_KEY,
    node: process.version
  });
};
