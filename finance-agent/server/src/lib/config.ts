const env = process.env;

export const config = {
  port: Number(env.PORT ?? 3000),
  jwtSecret: env.JWT_SECRET ?? 'dev-secret-change-me',
  // Durée de session : 30 minutes d'inactivité (prolongée par /api/auth/refresh)
  sessionTimeoutMinutes: Number(env.SESSION_TIMEOUT_MINUTES ?? 30),
  tz: env.TZ_NAME ?? 'Europe/Paris',
  corsOrigin: env.CORS_ORIGIN ?? 'http://localhost:5173',
  reminderIntervalMinutes: Number(env.REMINDER_INTERVAL_MINUTES ?? 60),
  // Tentatives de connexion/inscription autorisées par minute et par IP
  authRateLimit: Number(env.AUTH_RATE_LIMIT ?? 10),
  smtp: {
    host: env.SMTP_HOST || undefined,
    port: Number(env.SMTP_PORT ?? 587),
    user: env.SMTP_USER || undefined,
    pass: env.SMTP_PASS || undefined,
    from: env.SMTP_FROM ?? 'Agent financier <no-reply@example.com>',
  },
};
