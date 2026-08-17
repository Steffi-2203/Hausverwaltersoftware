const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  console.error('FATAL: SESSION_SECRET is not set. Aborting startup.');
  process.exit(1);
}

export default SESSION_SECRET;
