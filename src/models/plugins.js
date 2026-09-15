import { Counter } from "./Counter.js";

/**
 * Serialises documents exactly the way the dashboard's TypeScript types expect:
 * `_id` becomes `id`, internal fields are dropped. Applied to sub-schemas too,
 * so embedded attachments/activity items also expose `id`.
 */
export function toJSONPlugin(schema) {
  schema.set("toJSON", {
    virtuals: true,
    versionKey: false,
    transform(_doc, ret) {
      ret.id = String(ret._id ?? ret.id);
      delete ret._id;
      delete ret.__v;
      delete ret.passwordHash;
      delete ret.tokenVersion;
      return ret;
    },
  });
  schema.set("toObject", { virtuals: true });
}

/**
 * Gives a collection a human-readable business key (LD-1042, WK-2201, …)
 * alongside its ObjectId, generated atomically so concurrent writes never clash.
 */
export function codePlugin(schema, { prefix, counter, pad = 0 }) {
  schema.add({ code: { type: String, unique: true, index: true } });

  schema.pre("validate", async function assignCode(next) {
    if (this.code) return next();
    try {
      const seq = await Counter.next(counter);
      this.code = `${prefix}-${pad ? String(seq).padStart(pad, "0") : seq}`;
      return next();
    } catch (err) {
      return next(err);
    }
  });
}
