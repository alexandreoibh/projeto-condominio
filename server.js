'use strict'
const app = require('./src/app');
const postgres = require('./src/database/postgres');
const port = process.env.PORT  || 3001
console.log(`Oi starting on port... ${port}`);

postgres.authenticate()
    .then(() => {
        console.log('PostgreSQL conectado com sucesso.');
        app.listen(port, () => {
            console.log(`Porta ${port}`);
        });
    })
    .catch((error) => {
        console.error('Falha ao conectar no PostgreSQL:', error.message);
        process.exit(1);
    });



