require('dotenv').config();

// console.log(process.env.DB_USERNAME_N,'VVVVVVV AAAAAAA',process.env.DB_HOST_N);
const useSSL = process.env.DB_SSL === 'true';

module.exports = {
    dialect: 'postgres',
    dialectModule: require('pg'),
    host: process.env.DB_HOST_SQL_POSTGRE,
    port: process.env.PORTA_SQL_POSTGRE,
    username: process.env.USER_SQL_POSTGRE,
    password: process.env.PASSWORD_SQL_POSTGRE,
    database: process.env.DATABASE_POSTGRE,
    dialectOptions: useSSL
        ? {
            ssl: {
                require: true,
                rejectUnauthorized: false
            }
        }
        : {},
    define: {
        timestamp: true,
        underscored: true,
    },
}

