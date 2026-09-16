const required = (name, fallback = null) => {
  const v = process.env[name];
  if (v !== undefined && v !== "") return v;
  if (fallback !== null) return fallback;
  throw new Error(`Missing required environment variable: ${name}`);
};

export const env = {
  port: Number(process.env.PORT) || 5000,
  nodeEnv: process.env.NODE_ENV || "development",
  mongoUri: required("MONGO_URI", "mongodb://127.0.0.1:27017/maaadagency"),
  clientOrigin: process.env.CLIENT_ORIGIN || "http://localhost:3000",

  jwtAccessSecret: required("JWT_ACCESS_SECRET", "dev-only-change-me-use-strong-secret-in-production"),
  jwtRefreshSecret: required("JWT_REFRESH_SECRET", "dev-only-change-me-use-strong-secret-in-production"),
  jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",

  seedAdminEmail: (process.env.SEED_ADMIN_EMAIL || "admin@maaadagency.com").toLowerCase().trim(),
  seedAdminPassword: process.env.SEED_ADMIN_PASSWORD || "Admin@12345",
  seedEmployeePassword: process.env.SEED_EMPLOYEE_PASSWORD || "Employee@12345",

  whatsappApiVersion: process.env.WHATSAPP_API_VERSION || "v21.0",
  whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
  whatsappBusinessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "",
  whatsappAccessToken: process.env.WHATSAPP_ACCESS_TOKEN || "",
  whatsappVerifyToken: process.env.WHATSAPP_VERIFY_TOKEN || "",
  whatsappAppSecret: process.env.WHATSAPP_APP_SECRET || "",
  whatsappDryRun: String(process.env.WHATSAPP_DRY_RUN || "true").toLowerCase() === "true",

  uploadDir: process.env.UPLOAD_DIR || "uploads",
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB) || 15,
};

export const isProd = env.nodeEnv === "production";
export const isDev = env.nodeEnv === "development";

export const whatsappConfigured = Boolean(
  env.whatsappPhoneNumberId && env.whatsappAccessToken && !env.whatsappDryRun
);
