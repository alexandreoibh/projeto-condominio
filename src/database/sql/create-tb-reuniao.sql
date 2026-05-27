-- Migration: criar tabelas do modulo de reunioes
-- Schema: condominio-bh
-- Data: 2026-04-25

-- Tabela principal de reunioes
CREATE TABLE IF NOT EXISTS "condominio-bh".tb_reuniao (
    id                  SERIAL PRIMARY KEY,
    id_condominio       INTEGER NOT NULL,
    titulo              VARCHAR(255) NOT NULL,
    descricao           TEXT,
    tipo                VARCHAR(50) NOT NULL DEFAULT 'ordinaria',  -- ordinaria | extraordinaria | sindico
    data_hora           TIMESTAMPTZ NOT NULL,
    local               VARCHAR(255),
    link_online         VARCHAR(500),
    pauta               TEXT,
    ata                 TEXT,
    status              VARCHAR(50) NOT NULL DEFAULT 'agendada',   -- agendada | realizada | cancelada
    id_usuario_criador  INTEGER,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tb_reuniao_id_condominio
    ON "condominio-bh".tb_reuniao (id_condominio);

CREATE INDEX IF NOT EXISTS idx_tb_reuniao_data_hora
    ON "condominio-bh".tb_reuniao (data_hora DESC);

CREATE INDEX IF NOT EXISTS idx_tb_reuniao_status
    ON "condominio-bh".tb_reuniao (status);

-- Tabela de confirmacao de presenca (RSVP)
CREATE TABLE IF NOT EXISTS "condominio-bh".tb_reuniao_presenca (
    id               SERIAL PRIMARY KEY,
    id_reuniao       INTEGER NOT NULL REFERENCES "condominio-bh".tb_reuniao(id) ON DELETE CASCADE,
    id_usuario       INTEGER NOT NULL,
    status_presenca  VARCHAR(50) NOT NULL DEFAULT 'confirmado',  -- confirmado | recusado | pendente
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_reuniao_presenca UNIQUE (id_reuniao, id_usuario)
);

CREATE INDEX IF NOT EXISTS idx_tb_reuniao_presenca_reuniao
    ON "condominio-bh".tb_reuniao_presenca (id_reuniao);

CREATE INDEX IF NOT EXISTS idx_tb_reuniao_presenca_usuario
    ON "condominio-bh".tb_reuniao_presenca (id_usuario);
