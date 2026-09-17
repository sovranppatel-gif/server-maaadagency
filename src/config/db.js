import mongoose from "mongoose";
import dns from "node:dns";
import { env, isProd } from "./env.js";

mongoose.set("strictQuery", true);
if (!isProd) mongoose.set("debug", false);

function configureDns() {
  const PUBLIC_DNS = ["8.8.8.8", "1.1.1.1"];

  if (process.env.MONGO_DNS_SERVERS) {
    try {
      dns.setServers(
        process.env.MONGO_DNS_SERVERS.split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      );
      return;
    } catch {
      // ignore — fall back below
    }
  }

  try {
    const merged = [...new Set([...PUBLIC_DNS, ...dns.getServers()])];
    dns.setServers(merged);
  } catch {
    // ignore
  }
}

configureDns();

async function resolveSrvToDirectUri(srvUri) {
  if (!srvUri.startsWith("mongodb+srv://")) return srvUri;

  const withoutScheme = srvUri.slice("mongodb+srv://".length);
  const atIdx = withoutScheme.indexOf("@");
  const creds = atIdx >= 0 ? withoutScheme.slice(0, atIdx + 1) : "";
  const afterCreds = atIdx >= 0 ? withoutScheme.slice(atIdx + 1) : withoutScheme;
  const slashIdx = afterCreds.indexOf("/");
  const host =
    slashIdx >= 0 ? afterCreds.slice(0, slashIdx) : afterCreds.split("?")[0];
  const pathAndQuery = slashIdx >= 0 ? afterCreds.slice(slashIdx) : "";

  const srvHost = `_mongodb._tcp.${host}`;
  const [srvRecords, txtRecords] = await Promise.all([
    dns.promises.resolve(srvHost, "SRV"),
    dns.promises.resolve(srvHost, "TXT").catch(() => []),
  ]);

  const hosts = srvRecords.map((r) => `${r.name}:${r.port}`).join(",");
  const [dbPath, query = ""] = pathAndQuery.split("?");
  const txtOptions = txtRecords
    .flatMap((record) =>
      (Array.isArray(record) ? record.join("") : String(record))
        .split("&")
        .map((part) => part.trim())
        .filter(Boolean)
    )
    .filter((opt) => !query.includes(opt.split("=")[0] + "="));

  const mergedQuery = [query, "ssl=true", ...txtOptions].filter(Boolean).join("&");
  const needsAuthSource =
    creds && !mergedQuery.split("&").some((part) => part.startsWith("authSource="));
  const finalQuery = needsAuthSource
    ? `${mergedQuery}&authSource=admin`
    : mergedQuery;
  return `mongodb://${creds}${hosts}${dbPath}?${finalQuery}`;
}

export async function connectDB() {
  const srvUri = env.mongoUri;

  if (!srvUri) {
    throw new Error("❌ MONGO_URI environment variable is NOT SET!");
  }

  const sanitizedUri = srvUri.replace(/:[^@]+@/, ":***@");
  console.log("\n═══════════════════════════════════════════════════");
  console.log("[MongoDB] Starting connection attempt...");
  console.log("[MongoDB] URI Type:", srvUri.includes("+srv") ? "SRV" : "DIRECT");
  console.log("[MongoDB] Sanitized URI:", sanitizedUri);
  console.log("═══════════════════════════════════════════════════\n");

  const options = {
    autoIndex: true,
    serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS) || 30000,
    socketTimeoutMS: 45000,
    connectTimeoutMS: 30000,
    maxPoolSize: 5,
    minPoolSize: 1,
  };

  if (!srvUri.startsWith("mongodb+srv://")) {
    try {
      await mongoose.connect(srvUri, options);
      const { host, name } = mongoose.connection;
      console.log(`✅ MongoDB connected: db="${name}" host="${host}"`);
      return;
    } catch (err) {
      console.error("❌ Direct connection failed:", err.code, err.message);
      throw err;
    }
  }

  try {
    console.log("[MongoDB] Attempting SRV connection (mongodb+srv://)...");
    await mongoose.connect(srvUri, options);
    const { host, name } = mongoose.connection;
    console.log(`✅ MongoDB connected via SRV: db="${name}" host="${host}"`);
    return;
  } catch (err) {
    console.error(`⚠️ SRV connection failed (${err.code}): ${err.message}`);

    const dnsFailure =
      err.code === "ECONNREFUSED" ||
      err.code === "ENOTFOUND" ||
      err.code === "ETIMEOUT" ||
      String(err.message || "").includes("querySrv");

    if (!dnsFailure) {
      console.error("❌ Not a DNS error, cannot recover");
      throw err;
    }

    console.log("[MongoDB] Trying fallback: direct host list...");
    try {
      const directUri = await resolveSrvToDirectUri(srvUri);
      await mongoose.connect(directUri, options);
      const { host, name } = mongoose.connection;
      console.log(`✅ MongoDB connected via fallback: db="${name}" host="${host}"`);
      return;
    } catch (directErr) {
      console.error("❌ Direct host connection failed:", directErr.message);
      throw directErr;
    }
  }
}

export async function disconnectDB() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}
