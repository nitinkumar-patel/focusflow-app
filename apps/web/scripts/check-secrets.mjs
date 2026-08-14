// Fail closed before the Next.js server ever binds — see spec AC19.
// NEXTAUTH_SECRET is the working name pending T9's framework-currency
// check against current NextAuth v5 docs (may become AUTH_SECRET).
const required = ["INTERNAL_API_SECRET", "NEXTAUTH_SECRET"];
const missing = required.filter((name) => !process.env[name]);

if (missing.length > 0) {
  console.error(
    `FATAL: required secret(s) unset or empty: ${missing.join(", ")}. Refusing to start — see .env.example.`,
  );
  process.exit(1);
}
