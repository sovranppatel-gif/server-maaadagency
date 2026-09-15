import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { toJSONPlugin } from "./plugins.js";
import { ROLES } from "./common.js";
import { avatarColorFor } from "../utils/format.js";

/**
 * Authentication identity. Employee profiles live in their own collection:
 * a User with role EMPLOYEE links to one via the `employee` reference.
 */
const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, default: "EMPLOYEE", index: true },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
    avatarColor: { type: String, default: "#C5161D" },
    isActive: { type: Boolean, default: true },
    lastLoginAt: Date,
    tokenVersion: { type: Number, default: 0, select: false },
  },
  { timestamps: true }
);

userSchema.plugin(toJSONPlugin);

userSchema.pre("save", function setAvatar(next) {
  if (!this.avatarColor || this.isModified("email")) this.avatarColor = avatarColorFor(this.email);
  next();
});

userSchema.statics.hashPassword = (plain) => bcrypt.hash(plain, 12);

userSchema.methods.verifyPassword = function verifyPassword(plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

export const User = mongoose.model("User", userSchema);
