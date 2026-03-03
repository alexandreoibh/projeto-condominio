require('dotenv').config();
// console.log(process.env.DB_USERNAME_N,'VVVVVVV AAAAAAA',process.env.DB_HOST_N);
module.exports = {
    db1: {
        dialect: 'mysql',
        dialectModule: require('mysql2'),
        host: process.env.DB_HOST_SISVENDA,
        port: process.env.PORTA_SQL_SISVENDA,
        username: process.env.USER_SQL_SISVENDA,
        password: process.env.PASSWORD_SQL_SISVENDA,
        database: process.env.DATABASE_SISVENDA,
        define: {
            timestamp: true,
            underscored: true
        }
    },
    db2: {
        dialect: 'mysql',
        dialectModule: require('mysql2'),
        host: process.env.DB_HOST_SELEME,
        port: process.env.PORTA_SQL_SELEME,
        username: process.env.USER_SQL_SELEME,
        password: process.env.PASSWORD_SQL_SELEME,
        database: process.env.DATABASE_SELEME,
        define: {
            timestamp: true,
            underscored: true
        }
    }
}