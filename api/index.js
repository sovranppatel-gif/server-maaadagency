import { createApp } from "../src/app.js";

const app = createApp();

// Temporary test route to verify Vercel routing works
app.get("/api/vercel-test", (_req, res) => {
  res.json({
    status: "VERCEL DEPLOYMENT WORKING",
    timestamp: new Date().toISOString(),
    message: "If you see this, Vercel function is being invoked correctly"
  });
});

export default app;
