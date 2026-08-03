'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'condominio-bh' AND table_name = 'tb-usuarios' AND column_name = 'mensagem_whatsapp'
        ) THEN
          ALTER TABLE "condominio-bh"."tb-usuarios" ADD COLUMN mensagem_whatsapp BOOLEAN DEFAULT true;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'condominio-bh' AND table_name = 'tb-usuarios' AND column_name = 'mensagem_telegram'
        ) THEN
          ALTER TABLE "condominio-bh"."tb-usuarios" ADD COLUMN mensagem_telegram BOOLEAN DEFAULT true;
        END IF;
      END $$;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE "condominio-bh"."tb-usuarios" DROP COLUMN IF EXISTS mensagem_whatsapp;
      ALTER TABLE "condominio-bh"."tb-usuarios" DROP COLUMN IF EXISTS mensagem_telegram;
    `);
  }
};
