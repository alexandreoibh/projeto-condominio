'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'condominio-bh' AND table_name = 'tb-usuarios' AND column_name = 'chat_id_telegram'
        ) THEN
          ALTER TABLE "condominio-bh"."tb-usuarios" ADD COLUMN chat_id_telegram VARCHAR(50);
        END IF;
      END $$;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE "condominio-bh"."tb-usuarios" DROP COLUMN IF EXISTS chat_id_telegram;
    `);
  }
};
