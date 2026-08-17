// Fail closed before the Next.js server ever binds — see spec AC19.
// AUTH_SECRET confirmed as NextAuth v5's primary secret var name
// against the installed package's own type definitions (T9).
const required = ["INTERNAL_API_SECRET", "AUTH_SECRET"];
const missing = required.filter((name) => !process.env[name]);

if (missing.length > 0) {
  console.error(
    `FATAL: required secret(s) unset or empty: ${missing.join(", ")}. Refusing to start — see .env.example.`,
  );
  process.exit(1);
}
