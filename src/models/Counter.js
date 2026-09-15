import mongoose from "mongoose";

/** Atomic sequence generator backing human-readable document codes. */
const counterSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 },
  },
  { versionKey: false }
);

counterSchema.statics.next = async function next(name) {
  const doc = await this.findByIdAndUpdate(
    name,
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();
  return doc.seq;
};

/** Fast-forward a sequence after seeding so new records continue the series. */
counterSchema.statics.setFloor = async function setFloor(name, value) {
  await this.findByIdAndUpdate(name, { $max: { seq: value } }, { upsert: true });
};

export const Counter = mongoose.model("Counter", counterSchema);
