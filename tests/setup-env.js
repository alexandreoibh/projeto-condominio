'use strict';

// Variáveis de ambiente de TESTE (nunca valores reais).
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-0123456789abcdef0123456789abcdef';
process.env.SERVICE_INVITE_TOKEN_SECRET = 'test-invite-secret-fedcba9876543210fedcba9876543210';
process.env.BLOB_STORAGE_URL = 'https://teststore.private.blob.vercel-storage.com';
process.env.BLOB_READ_WRITE_TOKEN = 'test-blob-token';
process.env.BLOB_PRIVATE_READ_WRITE_TOKEN = 'test-blob-token';
process.env.APP_URL = 'https://app.emorador.test';
process.env.RECOVERY_CODE_SECRET = 'test-recovery-secret-0123456789abcdef0123456789';
process.env.PROXY_SHARED_SECRET = 'test-proxy-shared-secret-0123456789';
process.env.RECOVERY_TEMPO_MINIMO_MS = '0';
delete process.env.TRUSTED_PROXY_IPS;
delete process.env.WEBHOOK_BANCARIO_SECRET;
delete process.env.EXPOR_DETALHE_ERRO;
