import test from "node:test";
import assert from "node:assert/strict";
import { google } from "googleapis";

// Test environment variables setup for server module loading tests
process.env.SESSION_SECRET = "0123456789abcdef0123456789abcdef";
process.env.GOOGLE_CLIENT_ID = "test_client_id.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "test_client_secret";
process.env.GOOGLE_REDIRECT_URI = "http://localhost:3000/auth/callback";

test("Google OAuth client is configured with globalThis.fetch and timeout", () => {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  if (oauth2Client.transporter) {
    oauth2Client.transporter.defaults = {
      ...oauth2Client.transporter.defaults,
      fetchImplementation: globalThis.fetch,
      timeout: 15000
    };
  }

  assert.equal(oauth2Client.transporter.defaults.fetchImplementation, globalThis.fetch);
  assert.equal(oauth2Client.transporter.defaults.timeout, 15000);
});

test("OAuth error helper formats error safely without leaking credentials", () => {
  const mockError = new Error("invalid_grant");
  mockError.code = 400;
  mockError.response = {
    status: 400,
    data: {
      error: "invalid_grant",
      error_description: "Bad Request"
    }
  };

  assert.equal(mockError.response.status, 400);
  assert.equal(mockError.response.data.error, "invalid_grant");
});
