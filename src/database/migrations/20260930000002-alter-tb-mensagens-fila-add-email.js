'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // Canal e-mail na fila de mensagens: amplia a CHECK de `tipo` (criada
    // inline, com nome gerado pelo Postgres — por isso é descoberta em
    // pg_constraint) e adiciona `assunto`, usado só por tipo='email'.
    await queryInterface.sequelize.query(`
      DO $$
      DECLARE
        nome_constraint TEXT;
      BEGIN
        FOR nome_constraint IN
          SELECT conname FROM pg_constraint
           WHERE conrelid = '"condominio-bh".tb_mensagens_fila'::regclass
             AND contype = 'c'
             AND pg_get_constraintdef(oid) LIKE '%tipo%'
        LOOP
          EXECUTE 'ALTER TABLE "condominio-bh".tb_mensagens_fila DROP CONSTRAINT ' || quote_ident(nome_constraint);
        END LOOP;

        ALTER TABLE "condominio-bh".tb_mensagens_fila
          ADD CONSTRAINT tb_mensagens_fila_tipo_check CHECK (tipo IN ('whatsapp', 'telegram', 'email'));

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'condominio-bh' AND table_name = 'tb_mensagens_fila' AND column_name = 'assunto'
        ) THEN
          ALTER TABLE "condominio-bh".tb_mensagens_fila ADD COLUMN assunto VARCHAR(150) NULL;
        END IF;
      END $$;
    `);
  },

  async down(queryInterface) {
    // Falha se já houver linhas tipo='email' — remova-as antes de reverter.
    await queryInterface.sequelize.query(`
      ALTER TABLE "condominio-bh".tb_mensagens_fila DROP CONSTRAINT IF EXISTS tb_mensagens_fila_tipo_check;
      ALTER TABLE "condominio-bh".tb_mensagens_fila
        ADD CONSTRAINT tb_mensagens_fila_tipo_check CHECK (tipo IN ('whatsapp', 'telegram'));
      ALTER TABLE "condominio-bh".tb_mensagens_fila DROP COLUMN IF EXISTS assunto;
    `);
  }
};
