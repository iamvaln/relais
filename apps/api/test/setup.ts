// Environnement de chaque fichier de test. Chargé avant les imports de l'app.

process.env.NODE_ENV = 'test'
process.env.LOG_LEVEL = 'silent'
process.env.DATABASE_URL ??= `postgresql://relais@localhost:${process.env.TEST_PG_PORT ?? '55432'}/relais_test`
process.env.REDIS_URL ??= `redis://localhost:${process.env.TEST_REDIS_PORT ?? '55379'}`
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-0123456789abcdef0123456789'
process.env.JWT_STEPUP_SECRET ??= 'test-stepup-secret-0123456789abcdef0123456789'
process.env.TOKEN_HMAC_SECRET ??= 'test-hmac-secret-0123456789abcdef0123456789ab'
process.env.EMAIL_TRANSPORT = 'console'
process.env.STORAGE_BACKEND = 'memory'
process.env.FRONTEND_URL ??= 'http://localhost:3000'
