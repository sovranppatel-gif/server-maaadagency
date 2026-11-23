import { test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { User } from "../src/models/User.js";
import { authSchemas, employeeSchemas } from "../src/validators/index.js";
import { authorize } from "../src/middleware/auth.js";
import { createCredentialToken, hashCredentialToken } from "../src/utils/credentialToken.js";

test("generic registration cannot create or elevate an employee login", () => {
  const employeeRegistration = authSchemas.register.safeParse({
    name: "Employee",
    email: "employee@example.com",
    password: "A secure password",
    role: "EMPLOYEE",
  });
  assert.equal(employeeRegistration.success, false);

  const adminRegistration = authSchemas.register.parse({
    name: "Admin",
    email: "admin@example.com",
    password: "A secure password",
  });
  assert.equal(adminRegistration.role, "ADMIN");
});

test("employee profile creation rejects password-based login provisioning", () => {
  const profile = {
    name: "Employee",
    role: "Designer",
    email: "employee@example.com",
    phone: "9876543210",
    createLogin: true,
    password: "UnsafeDefault123",
  };
  assert.equal(employeeSchemas.create.safeParse(profile).success, false);
});

test("credential setup tokens are random, URL-safe and stored as one-way hashes", () => {
  const { token, hash } = createCredentialToken();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(hash, hashCredentialToken(token));
  assert.notEqual(hash, token);
});

test("user JSON never exposes password or credential setup fields", () => {
  const user = new User({
    _id: new mongoose.Types.ObjectId(),
    name: "Employee",
    email: "employee@example.com",
    role: "EMPLOYEE",
    employee: new mongoose.Types.ObjectId(),
    passwordHash: "stored-hash",
    tokenVersion: 4,
    credentialSetupTokenHash: "stored-token-hash",
    credentialSetupExpiresAt: new Date(),
    credentialSetupPurpose: "INVITATION",
  });

  const json = user.toJSON();
  for (const key of ["passwordHash", "tokenVersion", "credentialSetupTokenHash", "credentialSetupExpiresAt", "credentialSetupPurpose"]) {
    assert.equal(json[key], undefined);
  }
});

test("employee credentials cannot pass admin route authorization", () => {
  let receivedError;
  authorize("ADMIN")({ user: { role: "EMPLOYEE" } }, {}, (error) => { receivedError = error; });
  assert.equal(receivedError?.statusCode, 403);

  let allowed = false;
  authorize("ADMIN")({ user: { role: "MASTER_ADMIN" } }, {}, (error) => { allowed = !error; });
  assert.equal(allowed, true);
});
